import type { AcpConfigOption, HarnessId } from "./harness.js";
import { reportedAgentControls } from "./agent-controls.js";

/** Whether a thread's next turn plans or acts. A thread without one acts. */
export type TurnMode = "plan" | "act";

export function isTurnMode(value: unknown): value is TurnMode {
  return value === "plan" || value === "act";
}

/** Sent ahead of the prompt when the agent cannot be put into a plan mode of its own, or needs telling. */
export const PLAN_INSTRUCTION = [
  "[Plan mode] Plan only. Read and investigate as much as you need, but do not edit or create files,",
  "do not run commands that change anything, and do not commit. Reply with a concise, numbered",
  "implementation plan, then stop and wait for the user to approve it.",
].join(" ");

/** What "Act on this plan" sends. */
export const ACT_ON_PLAN_PROMPT = "Implement the plan above.";

export function planPrompt(content: string): string {
  return `${PLAN_INSTRUCTION}\n\n${content}`;
}

/** Who stops a plan turn from editing: the agent's own plan mode or a read-only sandbox. */
export type PlanEnforcement = "agent" | "read-only";

/**
 * Plan support for Capsule's own direct adapters, known before the agent starts.
 * These adapters report a `mode` setting with a plan choice once running, so the
 * live report and this table agree; the table only answers before the agent starts.
 */
export const NATIVE_PLAN_MODES: Partial<Record<HarnessId, { enforcement: PlanEnforcement; instruction: boolean; detail: string }>> = {
  claude: {
    enforcement: "agent",
    instruction: false,
    detail: "Claude Code runs plan turns in its own plan mode: it reads and investigates, and it cannot edit files or run commands that change them.",
  },
  codex: {
    enforcement: "read-only",
    instruction: true,
    detail: "Codex runs plan turns in its read-only sandbox without approval prompts, so it cannot change files. Capsule also asks it to plan rather than act.",
  },
};

export type PlanRoute = "direct" | "gateway" | "mock";

export type PlanCarrier =
  /** The agent reports a mode setting with a plan choice; Capsule switches it. */
  | { kind: "agent-mode"; optionId: string; planValue: string; enforcement: PlanEnforcement; instruction: boolean }
  /** A Capsule adapter that will report a plan mode once started. */
  | { kind: "native"; enforcement: PlanEnforcement; instruction: boolean }
  | { kind: "instruction" }
  | { kind: "mock" };

export interface PlanModeSupport {
  carrier: PlanCarrier;
  enforced: boolean;
  /** Short words for the chip's tooltip and the run event. */
  label: string;
  detail: string;
}

const PLAN_WORD = /(^|[^a-z])plan([^a-z]|$)/i;
const ACT_WORD = /^(default|code|act|build|agent|normal|edit|write)$/i;

/** The reported mode setting and its plan choice, if the agent has one. */
export function findPlanOption(options: readonly AcpConfigOption[] = []): { option: AcpConfigOption; planValue: string } | undefined {
  const option = reportedAgentControls([...options]).mode;
  if (!option) return;
  const plan = option.choices.find((choice) => PLAN_WORD.test(choice.value)) ?? option.choices.find((choice) => PLAN_WORD.test(choice.name));
  return plan ? { option, planValue: plan.value } : undefined;
}

/** Which mode to return to for an Act turn: the saved choice, the current one, or the likeliest working mode. */
export function actModeValue(option: AcpConfigOption, planValue: string, saved?: string | boolean): string | undefined {
  const usable = (value: unknown): value is string => typeof value === "string" && value !== planValue
    && option.choices.some((choice) => choice.value === value);
  if (usable(saved)) return saved;
  if (usable(option.currentValue)) return option.currentValue;
  const rest = option.choices.filter((choice) => choice.value !== planValue);
  return (rest.find((choice) => ACT_WORD.test(choice.value)) ?? rest[0])?.value;
}

/** The mode setting as the composer's picker shows it once the Plan chip owns the plan choice. */
export function withoutPlanChoice(option: AcpConfigOption | undefined): AcpConfigOption | undefined {
  const plan = option && findPlanOption([option]);
  if (!option || !plan) return option;
  const choices = option.choices.filter((choice) => choice.value !== plan.planValue);
  return choices.length > 1 ? { ...option, choices } : undefined;
}

export function planModeSupport(input: {
  harnessId?: string;
  harnessName?: string;
  route: PlanRoute;
  options?: readonly AcpConfigOption[];
  /** The agent has reported its settings, so a missing plan mode is known rather than pending. */
  reported: boolean;
}): PlanModeSupport {
  const name = input.harnessName ?? "This agent";
  if (input.route === "mock") {
    return { carrier: { kind: "mock" }, enforced: true, label: "Demo runtime, no edits",
      detail: "The demo runtime never edits files. Plan turns reply with a plan." };
  }
  const native = input.route === "direct" && input.harnessId ? NATIVE_PLAN_MODES[input.harnessId as HarnessId] : undefined;
  const found = findPlanOption(input.options);
  if (found) {
    const enforcement = native?.enforcement ?? "agent";
    return {
      carrier: { kind: "agent-mode", optionId: found.option.id, planValue: found.planValue, enforcement, instruction: native?.instruction ?? false },
      enforced: true,
      label: enforcement === "read-only" ? `Read-only, enforced by ${name}` : `Enforced by ${name}`,
      detail: native?.detail ?? (input.route === "gateway"
        ? `${name} reports its own plan mode. Capsule switches it on through the Gateway before each plan turn and back for Act.`
        : `${name} reports its own plan mode. Capsule switches it on before each plan turn and back for Act.`),
    };
  }
  if (native) {
    return { carrier: { kind: "native", enforcement: native.enforcement, instruction: native.instruction }, enforced: true,
      label: native.enforcement === "read-only" ? `Read-only, enforced by ${name}` : `Enforced by ${name}`, detail: native.detail };
  }
  return {
    carrier: { kind: "instruction" },
    enforced: false,
    label: "Asked, not enforced",
    detail: input.reported
      ? `${name} does not report a plan mode${input.route === "gateway" ? " through the Gateway" : ""}. Capsule asks it to plan without editing, but cannot stop it from changing files.`
      : `${name} has not reported a plan mode yet. Capsule asks it to plan without editing; if it reports its own plan mode when it starts, Capsule uses that instead.`,
  };
}

/** Whether a turn in this mode needs the plan instruction ahead of the prompt. */
export function needsPlanInstruction(support: PlanModeSupport): boolean {
  const carrier = support.carrier;
  return carrier.kind === "instruction" || ((carrier.kind === "agent-mode" || carrier.kind === "native") && carrier.instruction);
}

export type ModeModels = Record<string, { plan?: string; act?: string }>;

export function modeModelFor(modeModels: ModeModels | undefined, harnessId: string | undefined, mode: TurnMode): string | undefined {
  if (!harnessId) return;
  const value = modeModels?.[harnessId]?.[mode];
  return typeof value === "string" && value ? value : undefined;
}

/** Settings shape for per-mode models: known modes, short strings, a bounded number of agents. */
export function normalizeModeModels(value: unknown): ModeModels {
  const result: ModeModels = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [harnessId, entry] of Object.entries(value).slice(0, 64)) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(harnessId) || !entry || typeof entry !== "object") continue;
    const row: { plan?: string; act?: string } = {};
    for (const mode of ["plan", "act"] as const) {
      const model = (entry as Record<string, unknown>)[mode];
      if (typeof model === "string" && model.trim() && model.length <= 4096) row[mode] = model.trim();
    }
    if (row.plan || row.act) result[harnessId] = row;
  }
  return result;
}

/** A favorite is one model of one agent; the same model id can mean different things to two agents. */
export const modelFavoriteKey = (agentId: string, modelId: string) => JSON.stringify([agentId, modelId]);

export function normalizeFavoriteModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > 8192) continue;
    try {
      const parsed: unknown = JSON.parse(entry);
      if (Array.isArray(parsed) && parsed.length === 2 && parsed.every((part) => typeof part === "string" && part)) seen.add(entry);
    } catch { /* A malformed entry is dropped. */ }
  }
  return [...seen].slice(-100);
}

/** The next favorite of this agent after the current model, skipping models the agent no longer reports. */
export function nextFavoriteModel(favorites: readonly string[] = [], agentId: string, available: readonly string[], current?: string): string | undefined {
  const usable = available.filter((id) => favorites.includes(modelFavoriteKey(agentId, id)));
  if (!usable.length) return;
  const ordered = favorites.map((key) => usable.find((id) => modelFavoriteKey(agentId, id) === key)).filter((id): id is string => Boolean(id));
  const index = current ? ordered.indexOf(current) : -1;
  return ordered[(index + 1) % ordered.length];
}
