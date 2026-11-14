import {
  createId,
  type CustomizationRunRecord,
  type EffectiveExtendedConfig,
  type HookEvent,
  type HookHandler,
  type Provenance,
} from "@capsule/shared";
import { runWithInput } from "@capsule/terminal";

/*
 * Capsule's hooks run at the seams Capsule owns: the prompt it sends, the
 * permission requests it answers, the tool events it observes, and a turn
 * reaching its end. They hold for every agent and both routes because the
 * agent is never asked to run them.
 */

export const HOOK_TIMEOUT_S = 30;
export const HOOK_MAX_TIMEOUT_S = 120;
const OUTPUT_BYTES = 64 * 1024;
const STDERR_KEPT = 2048;
/** ToolCall observers running at once; more wait their turn rather than pile up processes. */
const OBSERVER_LIMIT = 4;
/** Follow-ups hooks may queue in a row before a thread waits for its person. */
export const HOOK_FOLLOW_UP_LIMIT = 3;

/** A PromptSubmit hook refused the prompt. Retrying the same text gets the same answer. */
export class PromptBlockedError extends Error {
  override name = "PromptBlockedError";
}

/** What every hook receives on stdin, or as the body of a POST. */
export interface HookPayload {
  event: HookEvent;
  thread_id: string;
  project_dir?: string;
  cwd: string;
  harness?: string;
  route: "gateway" | "direct";
  model?: string;
  prompt?: string;
  tool?: { kind?: string; title: string; status?: string; input?: string };
  permission?: { kind: string; title: string; command?: string; paths: string[]; url?: string };
  run?: { status: string; result_excerpt: string };
}

/** The JSON a hook may answer with. Unknown fields are ignored. */
export interface HookOutput {
  /** `block` for PromptSubmit; `allow`, `deny` or `ask` for PermissionRequest, short for `permissionDecision`. */
  decision?: "block" | "allow" | "deny" | "ask";
  reason?: string;
  additionalContext?: string;
  permissionDecision?: "allow" | "deny" | "ask";
  followUp?: string;
}

/** How one handler ended. `block` is exit 2 or a blocking JSON answer. */
export type HookOutcome =
  | { kind: "answered"; output: HookOutput }
  | { kind: "blocked"; reason: string }
  | { kind: "failed"; message: string };

export interface HookResult {
  handler: HookHandler;
  source: Provenance;
  outcome: HookOutcome;
}

export interface HookHost {
  extended(root?: string): EffectiveExtendedConfig;
  record(run: CustomizationRunRecord): void;
  /**
   * Whether a hook from this file may allow a permission request. One that
   * may not has its allow read as ask, so the person decides. Every file
   * may today; a source Capsule trusts less can be held back here.
   */
  mayAllow?(source: Provenance): boolean;
  /** Overridable for tests. */
  fetch?: typeof fetch;
}

/** The two events whose hooks can stop something. The others only observe. */
const CAN_BLOCK: Record<HookEvent, boolean> = { PromptSubmit: true, PermissionRequest: true, ToolCall: false, TurnEnd: false };
/** The events whose groups filter on a tool's kind and title. */
const USES_MATCHER: Record<HookEvent, boolean> = { PromptSubmit: false, PermissionRequest: true, ToolCall: true, TurnEnd: false };

/**
 * `Edit|Write` lists names compared without case to the tool's kind or
 * title; anything else is a regular expression tested against either. No
 * matcher, `*` or an empty one matches every tool.
 */
export function matcherAccepts(matcher: string | undefined, targets: readonly string[]): boolean {
  const pattern = matcher?.trim();
  if (!pattern || pattern === "*") return true;
  if (/^[\w\s|.-]+$/.test(pattern)) {
    const names = pattern.split("|").map((name) => name.trim().toLowerCase()).filter(Boolean);
    return targets.some((target) => names.includes(target.toLowerCase()));
  }
  try {
    const expression = new RegExp(pattern);
    return targets.some((target) => expression.test(target));
  } catch {
    return false;
  }
}

function timeoutMs(handler: HookHandler): number {
  const seconds = Math.min(Math.max(handler.timeout ?? HOOK_TIMEOUT_S, 1), HOOK_MAX_TIMEOUT_S);
  return seconds * 1000;
}

function readOutput(text: string): HookOutput | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const value = JSON.parse(trimmed) as Record<string, unknown>;
    const output: HookOutput = {};
    if (value.decision === "block" || value.decision === "allow" || value.decision === "deny" || value.decision === "ask") output.decision = value.decision;
    if (typeof value.reason === "string") output.reason = value.reason;
    if (typeof value.additionalContext === "string") output.additionalContext = value.additionalContext;
    if (value.permissionDecision === "allow" || value.permissionDecision === "deny" || value.permissionDecision === "ask") output.permissionDecision = value.permissionDecision;
    else if (output.decision && output.decision !== "block") output.permissionDecision = output.decision;
    if (typeof value.followUp === "string") output.followUp = value.followUp;
    return output;
  } catch {
    return undefined;
  }
}

/** A JSON answer that stops a blocking event counts as a block, like exit 2. */
function answer(output: HookOutput, event: HookEvent): HookOutcome {
  if (event === "PromptSubmit" && output.decision === "block") return { kind: "blocked", reason: output.reason?.trim() || "No reason given." };
  return { kind: "answered", output };
}

function describeOutcome(outcome: HookOutcome, event: HookEvent): string {
  if (outcome.kind === "failed") return outcome.message;
  if (outcome.kind === "blocked") return CAN_BLOCK[event] ? `blocked: ${outcome.reason}` : "exit 2, which cannot block this event";
  const { output } = outcome;
  if (output.permissionDecision) return `answered ${output.permissionDecision}`;
  if (output.additionalContext) return "added context";
  if (output.followUp) return "queued a follow-up";
  return "ok";
}

export class HookRunner {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly host: HookHost) {}

  mayAllow(source: Provenance): boolean {
    return this.host.mayAllow?.(source) ?? true;
  }

  /** The handlers that would run for this event, in file order. */
  handlers(event: HookEvent, root: string | undefined, targets: readonly string[] = []): Array<{ handler: HookHandler; source: Provenance; matcher?: string }> {
    const config = this.host.extended(root);
    if (config.disableAllHooks) return [];
    return (config.hooks[event] ?? []).flatMap(({ value: group, source }) =>
      !USES_MATCHER[event] || matcherAccepts(group.matcher, targets)
        ? group.hooks.map((handler) => ({ handler, source, ...(group.matcher ? { matcher: group.matcher } : {}) }))
        : []);
  }

  /** Run every matching handler at once and wait for all of them. */
  async run(event: HookEvent, payload: HookPayload, context: { root?: string; targets?: readonly string[] }): Promise<HookResult[]> {
    const selected = this.handlers(event, context.root, context.targets);
    return Promise.all(selected.map(async ({ handler, source, matcher }) => {
      const startedAt = new Date().toISOString();
      const started = Date.now();
      const { outcome, exitCode, stderr } = await this.execute(handler, payload, event);
      this.host.record({
        id: createId("hook"),
        kind: "hook",
        label: matcher ? `${event} (${matcher})` : event,
        command: handler.type === "command" ? handler.command : handler.url,
        source: source.path ?? source.scope,
        startedAt,
        durationMs: Date.now() - started,
        exitCode,
        ...(stderr ? { stderr: stderr.slice(-STDERR_KEPT) } : {}),
        outcome: describeOutcome(outcome, event),
      });
      return { handler, source, outcome };
    }));
  }

  /** Run observers without holding up the turn, a few at a time. */
  observe(event: HookEvent, payload: HookPayload, context: { root?: string; targets?: readonly string[] }): void {
    if (this.handlers(event, context.root, context.targets).length === 0) return;
    void this.slot().then((release) => this.run(event, payload, context).finally(release)).catch(() => undefined);
  }

  private async slot(): Promise<() => void> {
    if (this.running >= OBSERVER_LIMIT) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
    return () => {
      this.running--;
      this.waiting.shift()?.();
    };
  }

  private async execute(handler: HookHandler, payload: HookPayload, event: HookEvent): Promise<{ outcome: HookOutcome; exitCode: number | null; stderr?: string }> {
    const body = JSON.stringify(payload);
    const limit = timeoutMs(handler);
    if (handler.type === "http") {
      try {
        const response = await (this.host.fetch ?? fetch)(handler.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...handler.headers },
          body,
          signal: AbortSignal.timeout(limit),
        });
        const text = (await response.text()).slice(0, OUTPUT_BYTES);
        if (!response.ok) return { outcome: { kind: "failed", message: `HTTP ${response.status}` }, exitCode: response.status, stderr: text };
        const output = readOutput(text);
        return { outcome: output ? answer(output, event) : { kind: "answered", output: {} }, exitCode: 0 };
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        return { outcome: { kind: "failed", message: timedOut ? `timed out after ${limit / 1000}s` : `request failed: ${error instanceof Error ? error.message : String(error)}` }, exitCode: null };
      }
    }
    try {
      const result = await runWithInput(payload.cwd, handler.command, {
        input: body,
        env: { CAPSULE_PROJECT_DIR: payload.project_dir ?? payload.cwd },
        timeoutMs: limit,
        maxBytes: OUTPUT_BYTES,
      });
      if (result.timedOut) return { outcome: { kind: "failed", message: `timed out after ${limit / 1000}s` }, exitCode: null, stderr: result.stderr };
      if (result.code === 2) return { outcome: { kind: "blocked", reason: result.stderr.trim() || "No reason given." }, exitCode: 2, stderr: result.stderr };
      if (result.code !== 0) return { outcome: { kind: "failed", message: `exit ${result.code}` }, exitCode: result.code, stderr: result.stderr };
      const output = readOutput(result.stdout);
      return { outcome: output ? answer(output, event) : { kind: "answered", output: {} }, exitCode: 0, stderr: result.stderr };
    } catch (error) {
      return { outcome: { kind: "failed", message: `did not start: ${error instanceof Error ? error.message : String(error)}` }, exitCode: null };
    }
  }
}

/** Where a hook came from, in words for a notice or a run event. */
export function hookSource(source: Provenance, home?: string): string {
  const file = source.path ?? source.scope;
  return home && file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
}

/** PromptSubmit: the first block wins; every other answer may add context. */
export function promptVerdict(results: readonly HookResult[]): { block?: { reason: string; source: Provenance }; context: string[] } {
  const block = results.find((result) => result.outcome.kind === "blocked");
  if (block && block.outcome.kind === "blocked") return { block: { reason: block.outcome.reason, source: block.source }, context: [] };
  return {
    context: results.flatMap((result) => result.outcome.kind === "answered" && result.outcome.output.additionalContext?.trim()
      ? [result.outcome.output.additionalContext.trim()]
      : []),
  };
}

export interface PermissionVerdict {
  decision: "allow" | "deny" | "ask";
  reason?: string;
  source: Provenance;
}

/**
 * PermissionRequest: deny beats ask beats allow, as with rules, and exit 2
 * is a deny. One hook asking is enough for the person to decide, so a gate
 * holds even beside a hook that allows. A failure or silence is no verdict.
 * An allow from a file that may not allow becomes an ask.
 */
export function permissionVerdict(results: readonly HookResult[], mayAllow: (source: Provenance) => boolean = () => true): PermissionVerdict | undefined {
  const said = (result: HookResult) => result.outcome.kind === "blocked" ? "deny" : result.outcome.kind === "answered" ? result.outcome.output.permissionDecision : undefined;
  const reasonOf = (result: HookResult) => (result.outcome.kind === "blocked" ? result.outcome.reason : result.outcome.kind === "answered" ? result.outcome.output.reason : undefined)?.trim();
  const verdict = (result: HookResult, decision: PermissionVerdict["decision"]): PermissionVerdict => {
    const reason = reasonOf(result);
    return { decision, ...(reason ? { reason } : {}), source: result.source };
  };
  const deny = results.find((result) => said(result) === "deny");
  if (deny) return verdict(deny, "deny");
  const asks = results.filter((result) => said(result) === "ask" || (said(result) === "allow" && !mayAllow(result.source)));
  const ask = asks.find((result) => reasonOf(result)) ?? asks[0];
  if (ask) return verdict(ask, "ask");
  const allow = results.find((result) => said(result) === "allow");
  return allow ? verdict(allow, "allow") : undefined;
}

/** TurnEnd: each answer's follow-up text, in file order. */
export function followUpsFrom(results: readonly HookResult[]): string[] {
  return results.flatMap((result) => result.outcome.kind === "answered" && result.outcome.output.followUp?.trim()
    ? [result.outcome.output.followUp.trim()]
    : []);
}

/**
 * Hook follow-ups a thread has queued since its person last wrote. A message
 * that is not one of them resets the count, so a TurnEnd hook cannot keep a
 * thread talking to itself.
 */
export class FollowUpLoopGuard {
  private readonly threads = new Map<string, { streak: number; pending: string[] }>();

  /** Record a message about to be sent. */
  sent(threadId: string, content: string): void {
    const state = this.threads.get(threadId);
    const index = state?.pending.indexOf(content) ?? -1;
    if (state && index >= 0) state.pending.splice(index, 1);
    else this.threads.delete(threadId);
  }

  /** Whether one more hook follow-up may be queued; counts it when so. */
  admit(threadId: string, content: string): boolean {
    const state = this.threads.get(threadId) ?? { streak: 0, pending: [] };
    if (state.streak >= HOOK_FOLLOW_UP_LIMIT) return false;
    state.streak++;
    state.pending.push(content);
    this.threads.set(threadId, state);
    return true;
  }

  forget(threadId: string): void {
    this.threads.delete(threadId);
  }
}
