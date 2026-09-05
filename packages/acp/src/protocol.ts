import { sanitizeUntrusted, type AcpModelCatalog } from "@capsule/shared";

/*
 * The wire, on its own.
 *
 * An agent that speaks the Agent Client Protocol reads JSON-RPC from stdin and
 * writes it to stdout, one message per line. Everything in this file is pure:
 * framing in, framing out, and the shape of the notifications a turn produces.
 * The process that carries it lives in `session.ts`, so the parsing can be
 * tested without spawning anything.
 */

export const ACP_PROTOCOL_VERSION = 1;

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** One line of stdout, or nothing when the line is not a message. */
export function parseMessage(line: string): JsonRpcMessage | undefined {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as JsonRpcMessage;
    return parsed.jsonrpc === "2.0" ? parsed : undefined;
  } catch {
    // Agents write human-readable noise to stdout too — a banner, a warning.
    // A line that is not JSON is not an error, it is not for us.
    return undefined;
  }
}

/**
 * Split a stdout chunk into whole lines, returning what is left over.
 *
 * A write can land mid-message, so the tail has to be carried into the next
 * chunk rather than parsed and dropped.
 */
export function splitLines(buffered: string): { lines: string[]; rest: string } {
  const parts = buffered.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}

export function encodeMessage(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/** What a `session/update` notification is telling us about a turn. */
export interface SessionUpdate {
  sessionId?: string;
  /** Assistant text to show, if this update carries any. */
  text?: string;
  /** Reasoning rather than answer: shown, but not part of the reply. */
  thought?: boolean;
  /** A tool the agent is running, if this update is about one. */
  tool?: { title?: string; status?: string; toolCallId?: string };
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return undefined;
  const record = content as { type?: unknown; text?: unknown };
  if (record.type === "text" && typeof record.text === "string") return record.text;
  return undefined;
}

/**
 * Read one `session/update` notification.
 *
 * The protocol carries several update kinds on one method, distinguished by
 * `sessionUpdate`. Only the ones a reader sees are lifted here; the rest are
 * not errors, they are simply not shown.
 */
export function readSessionUpdate(params: unknown): SessionUpdate | undefined {
  if (!params || typeof params !== "object") return undefined;
  const record = params as { sessionId?: unknown; update?: unknown };
  const sessionId = typeof record.sessionId === "string" ? record.sessionId : undefined;
  const update = record.update;
  if (!update || typeof update !== "object") return undefined;
  const kind = (update as { sessionUpdate?: unknown }).sessionUpdate;

  if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
    const text = textFromContent((update as { content?: unknown }).content);
    if (text === undefined) return undefined;
    return { sessionId, text, thought: kind === "agent_thought_chunk" };
  }

  if (kind === "tool_call" || kind === "tool_call_update") {
    const tool = update as { title?: unknown; status?: unknown; toolCallId?: unknown };
    const title = typeof tool.title === "string" ? tool.title : undefined;
    const toolCallId = typeof tool.toolCallId === "string" ? tool.toolCallId : undefined;
    if (!title && !toolCallId) return undefined;
    return {
      sessionId,
      tool: { title, status: typeof tool.status === "string" ? tool.status : undefined, toolCallId },
    };
  }

  return undefined;
}

/** How a turn ended, from the `session/prompt` result. */
export function readStopReason(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const reason = (result as { stopReason?: unknown }).stopReason;
  return typeof reason === "string" ? reason : undefined;
}

/** What a stop reason means for the run that carried the turn. */
export interface TurnOutcome {
  /** One of the three the engine acts on; anything else leaves a run running. */
  status: "completed" | "failed" | "cancelled";
  /** Why, when the turn did not simply finish. */
  error?: string;
}

/*
 * A turn that stopped early is not a turn that finished.
 *
 * The protocol says how a turn ended, and Capsule used to read that field and
 * throw it away: every prompt whose promise resolved was recorded as
 * "completed". A refusal, an output limit and an ordinary silent reply were
 * indistinguishable, so the conversation could only fall back to "No reply was
 * received for this turn" without ever saying why — while the answer had been
 * on the wire the whole time.
 *
 * An unknown reason is still a reason the turn did not finish, so it fails
 * rather than passing as success. The text is echoed back to the person, and
 * it comes from the agent process, so it is sanitised and clamped to the
 * identifier shape these values actually have.
 */
export function turnOutcome(stopReason: string | undefined): TurnOutcome {
  switch (stopReason) {
    // No reason given is the older behaviour, and means the turn simply ended.
    case undefined:
    case "":
    case "end_turn":
      return { status: "completed" };
    case "cancelled":
    case "canceled":
      return { status: "cancelled", error: "The turn was cancelled." };
    case "refusal":
      return { status: "failed", error: "The agent declined to continue this turn." };
    case "max_tokens":
      return {
        status: "failed",
        error: "The agent reached its output limit before finishing this turn.",
      };
    case "max_turn_requests":
      return {
        status: "failed",
        error: "The agent reached its limit on tool calls before finishing this turn.",
      };
    default:
      return { status: "failed", error: `The agent stopped early: ${readableReason(stopReason)}.` };
  }
}

/*
 * Stop reasons are enum-like identifiers, so anything outside that shape is
 * not a stop reason and has no business being shown as one.
 */
function readableReason(reason: string): string {
  const cleaned = sanitizeUntrusted(reason, { maxChars: 60, singleLine: true })
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .trim();
  return cleaned || "no reason given";
}

/**
 * A permission request, as Capsule's approval prompt needs it.
 *
 * The agent blocks until this is answered, so a request that cannot be read is
 * worse than one that is denied — it hangs the turn. Anything unrecognised
 * returns undefined and the caller refuses it.
 */
export interface PermissionOption {
  optionId: string;
  name: string;
  kind?: string;
}

export interface PermissionRequest {
  sessionId?: string;
  title: string;
  options: PermissionOption[];
}

export function readPermissionRequest(params: unknown): PermissionRequest | undefined {
  if (!params || typeof params !== "object") return undefined;
  const record = params as { sessionId?: unknown; toolCall?: unknown; options?: unknown };
  if (!Array.isArray(record.options)) return undefined;
  const options = record.options
    .map((option): PermissionOption | undefined => {
      if (!option || typeof option !== "object") return undefined;
      const row = option as { optionId?: unknown; name?: unknown; kind?: unknown };
      if (typeof row.optionId !== "string") return undefined;
      return {
        optionId: row.optionId,
        name: typeof row.name === "string" ? row.name : row.optionId,
        ...(typeof row.kind === "string" ? { kind: row.kind } : {}),
      };
    })
    .filter((option): option is PermissionOption => Boolean(option));
  if (options.length === 0) return undefined;
  const tool = record.toolCall as { title?: unknown } | undefined;
  return {
    sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
    title: typeof tool?.title === "string" ? tool.title : "Run a tool",
    options,
  };
}

/**
 * The option to take for a permission decision.
 *
 * Agents name their options freely, so the choice is made on `kind`, which the
 * protocol does define, and only falls back to matching the name.
 */
export function chooseOption(
  options: PermissionRequest["options"],
  decision: "allow" | "deny",
): string | undefined {
  const wanted = decision === "allow" ? "allow" : "reject";
  const byKind = options.find((option) => option.kind === `${wanted}_once`);
  if (byKind) return byKind.optionId;
  const byName = options.find((option) => !option.kind && (
    decision === "allow"
      ? /^(allow|approve|yes)( once)?$/i.test(option.name.trim())
      : /^(reject|deny|no)( once)?$/i.test(option.name.trim())),
  );
  return byName?.optionId;
}

/**
 * The models an agent named when its session opened.
 *
 * ACP returns them from `session/new`, in the shape Capsule's picker already
 * speaks, so there is nothing to translate — only to not throw away.
 */
export function readModelCatalog(value: unknown): AcpModelCatalog | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { currentModelId?: unknown; availableModels?: unknown };
  if (!Array.isArray(record.availableModels)) return undefined;
  const availableModels = record.availableModels
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const row = entry as { modelId?: unknown; name?: unknown };
      if (typeof row.modelId !== "string" || !row.modelId) return undefined;
      return { modelId: row.modelId, name: typeof row.name === "string" ? row.name : row.modelId };
    })
    .filter((entry): entry is { modelId: string; name: string } => Boolean(entry));
  if (availableModels.length === 0) return undefined;
  return {
    ...(typeof record.currentModelId === "string" ? { currentModelId: record.currentModelId } : {}),
    availableModels,
  };
}
