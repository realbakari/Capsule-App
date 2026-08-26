export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function compactParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

export function extractGatewayText(payload: Record<string, unknown>): string {
  /*
   * ACP runtime frames nest their content one level down:
   *
   *   { stream: "acp", data: { phase: "runtime_event", eventType: "tool_call",
   *                            text: "Edit (pending)", title: "Edit", … } }
   *
   * Reading only the top level dropped every one of them, which is why the
   * execution log filled with hundreds of empty rows.
   */
  const nested = asRecord(payload.data);
  if (Object.keys(nested).length > 0) {
    const nestedText = asString(nested.text, asString(nested.title));
    if (nestedText) return nestedText;
  }
  const delta = asString(payload.deltaText);
  if (delta) return delta;
  const text = asString(payload.text);
  if (text) return text;
  const error = asString(payload.errorMessage);
  if (error) return error;
  const summary = asString(payload.summary);
  if (summary) return summary;
  const message = payload.message;
  if (typeof message === "string") return message;
  if (message && typeof message === "object") {
    const record = asRecord(message);
    const content = record.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          const item = asRecord(part);
          return asString(item.text, asString(item.content));
        })
        .filter(Boolean)
        .join("");
    }
    return asString(record.text);
  }
  return "";
}

export function isGatewayTurnDone(payload: Record<string, unknown>): boolean {
  const state = asString(payload.state);
  const status = asString(payload.status);
  const phase = asString(payload.phase);
  return (
    state === "final" ||
    state === "aborted" ||
    state === "error" ||
    status === "ok" ||
    status === "error" ||
    phase === "end" ||
    phase === "error"
  );
}

const ACP_FAIL = [
  "runtime backend is not configured",
  "acp is disabled",
  "is not allowed by policy",
  "unable to resolve session",
  "sandboxed sessions cannot spawn",
  "permissionpromptunavailable",
  "unknown command",
  "failed to spawn",
  "harness command not found",
  "requires operator.admin",
  "conversation bindings are unavailable",
  "binding requires a channel context",
  "bind here requires",
  "could not initialize acp",
  "acp spawn failed",
  "no api key found",
  "missing-provider-auth",
  "agent failed before reply",
];

export function acpCommandFailed(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined;
  const lower = text.toLowerCase();
  if (ACP_FAIL.some((needle) => lower.includes(needle))) return text.trim();
  return undefined;
}

export function extractAcpSessionKey(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.match(/agent:[a-z0-9_-]+:acp:[a-z0-9-]+/i);
  return match?.[0];
}

export function isGatewayAgentFailure(text: string | undefined): boolean {
  return Boolean(acpCommandFailed(text));
}

/*
 * The Gateway tags every agent frame with a `stream` naming what kind of
 * content it carries — the flattened form of ACP's session/update kinds
 * (agent_thought_chunk, tool_call, plan, …). Capsule used to collapse all of
 * them to "tool" or "assistant", which meant reasoning, plan text and stderr
 * were concatenated into the assistant's reply and the UI had nothing real to
 * show while a turn was in flight.
 *
 * The kinds below mirror T3 Code's RuntimeContentStreamKind: keep reasoning
 * separate from prose, and keep tool/command/patch output separate from both.
 */
export type AgentStreamKind =
  | "thinking"
  | "message"
  | "plan"
  | "tool"
  | "command"
  | "patch"
  | "error"
  | "lifecycle";

const STREAM_KINDS: Record<string, AgentStreamKind> = {
  thought: "thinking",
  thinking: "thinking",
  reasoning: "thinking",
  plan: "plan",
  tool: "tool",
  tool_call: "tool",
  tool_call_update: "tool",
  item: "tool",
  command_output: "command",
  stdout: "command",
  stderr: "command",
  output: "command",
  patch: "patch",
  diff: "patch",
  error: "error",
  lifecycle: "lifecycle",
  compaction: "lifecycle",
  approval: "lifecycle",
  assistant: "message",
  acp: "message",
};

/**
 * Maps a Gateway `stream` value to the kind Capsule reasons about. Unknown
 * streams fall back to "message", preserving the previous behaviour for
 * anything this table does not yet name.
 */
export function classifyAgentStream(stream: string | undefined): AgentStreamKind {
  const key = (stream ?? "").trim().toLowerCase();
  if (!key) return "message";
  if (STREAM_KINDS[key]) return STREAM_KINDS[key];
  // `tool`-prefixed variants the Gateway may add later.
  if (key.startsWith("tool")) return "tool";
  if (key.startsWith("reason") || key.startsWith("think")) return "thinking";
  return "message";
}

/** Only prose belongs in the assistant's reply; everything else is activity. */
export function isAssistantProse(kind: AgentStreamKind): boolean {
  return kind === "message";
}

/*
 * ACP surfaces protocol-level failures as raw text ("ACP_TURN_FAILED:
 * Permission prompt unavailable in non-interactive mode"). Those name the
 * mechanism, not the thing the user can do about it. Rewrite the ones we
 * understand into an instruction, and leave anything else untouched.
 */
const ACP_ERROR_GUIDANCE: Array<{ match: RegExp; guidance: string }> = [
  {
    match: /permission prompt unavailable in non-interactive mode/i,
    guidance:
      "ACP has no permission dialog. Writes, shell, and network need the Gateway plugin on approve-all, then a new spawn (old sessions keep the old flags).\n\nopenclaw config set plugins.entries.acpx.config.permissionMode approve-all\nopenclaw config set plugins.entries.acpx.config.nonInteractivePermissions deny\nopenclaw gateway restart\n\nThen Runtimes → Spawn again. In Capsule, Standard/Full access already maps to approve-all; Supervised refuses tools instead of asking.",
  },
  {
    match: /authentication required|please run \/login/i,
    guidance:
      "The harness CLI is not signed in on the Gateway host. Sign in to it, then run Doctor.",
  },
  {
    match: /no api key found for provider/i,
    guidance:
      "The turn was answered by the Gateway's own agent instead of your harness, and that agent has no provider credentials. Dedicate a harness to this project so the work routes through ACP.",
  },
];

/** Returns actionable guidance for a known ACP failure, else the original text. */
export function explainAcpFailure(text: string | undefined): string | undefined {
  const message = text?.trim();
  if (!message) return undefined;
  for (const entry of ACP_ERROR_GUIDANCE) {
    if (entry.match.test(message)) return `${message.split("\n")[0]}\n\n${entry.guidance}`;
  }
  return message;
}

/**
 * The kind of an ACP runtime frame, read from its nested `eventType` rather
 * than the outer `stream` (which is always "acp" and says nothing).
 *
 * `text_delta` frames carry no text at all — they are a "still typing" tick,
 * and the reply itself arrives on the acp-reply path — so they are lifecycle,
 * not content. Telemetry (`status`: usage/session/command updates) is likewise
 * not something the agent did.
 */
export function classifyRuntimeEvent(payload: Record<string, unknown>): AgentStreamKind | undefined {
  const nested = asRecord(payload.data);
  const eventType = asString(nested.eventType).toLowerCase();
  if (!eventType) return undefined;
  if (eventType === "tool_call") return "tool";
  if (eventType === "error") return "error";
  if (eventType === "text_delta" || eventType === "status" || eventType === "done") {
    return "lifecycle";
  }
  if (eventType.startsWith("think") || eventType.startsWith("reason")) return "thinking";
  if (eventType.startsWith("plan")) return "plan";
  return undefined;
}
