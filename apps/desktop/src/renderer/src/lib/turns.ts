import { isAcpCancelNotice, isAcpStatusNotice, type ChatMessage } from "@capsule/shared";

/*
 * A turn is one exchange: a user message plus everything that answered it,
 * up to the next user message. Grouping the flat message list this way is what
 * lets old exchanges fold: folding by turn rather than by message collapses an
 * expensive turn to one row instead of a dozen.
 */
export interface Turn {
  /** Stable across renders: the first message's id anchors the turn. */
  id: string;
  /** The prompt that opened the turn, when the turn started with one. */
  prompt?: ChatMessage;
  messages: ChatMessage[];
}

export function turnsFromMessages(messages: readonly ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    // Hide historical acknowledgements without deleting the stored history.
    if (message.role === "assistant" && (isAcpCancelNotice(message.content) || isAcpStatusNotice(message.content))) continue;
    const startsTurn = message.role === "user" && message.kind !== "steer";
    const open = turns.at(-1);
    if (startsTurn || !open) {
      turns.push({
        id: message.id,
        ...(message.role === "user" ? { prompt: message } : {}),
        messages: [message],
      });
      continue;
    }
    open.messages.push(message);
  }
  return turns;
}

/**
 * Which turns render folded. The newest `keepExpanded` turns always stay open —
 * you are almost always reading the end of a conversation — and anything the
 * reader has explicitly opened is honoured regardless of age.
 */
export function foldedTurnIds(
  turns: readonly Turn[],
  keepExpanded: number,
  openedByReader: ReadonlySet<string>,
): Set<string> {
  const folded = new Set<string>();
  const foldableCount = Math.max(0, turns.length - Math.max(0, keepExpanded));
  for (let index = 0; index < foldableCount; index += 1) {
    const turn = turns[index];
    if (!turn || openedByReader.has(turn.id)) continue;
    // A single-message turn is already one row; folding it saves nothing and
    // costs a click.
    if (turn.messages.length < 2) continue;
    folded.add(turn.id);
  }
  return folded;
}

/** One-line label for a folded turn: the prompt, else the first message. */
export function foldedTurnLabel(turn: Turn, limit = 80): string {
  const source = turn.prompt ?? turn.messages[0];
  const text = source?.content.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return "Earlier turn";
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * How long a turn took, from its prompt to its last message.
 *
 * Only meaningful for a turn that actually ran: a single-message turn has no
 * elapsed time, and a clock that reads "0s" on every user message is noise.
 * Returns undefined rather than zero so the caller renders nothing.
 */
export function turnDurationMs(turn: Turn): number | undefined {
  if (turn.messages.length < 2) return undefined;
  const first = turn.messages[0];
  const last = turn.messages.at(-1);
  if (!first || !last) return undefined;
  const start = Date.parse(first.createdAt);
  const end = Date.parse(last.createdAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  const elapsed = end - start;
  // Under a second is not worth a label, and a clock that ran backwards is a
  // clock change rather than a duration.
  return elapsed >= 1000 ? elapsed : undefined;
}

/** "4m 15s" — coarse on purpose; nobody needs a turn timed to the millisecond. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
}

/**
 * Prompt and the start of its answer, for the hover preview on a folded turn.
 *
 * A folded turn shows its prompt and a message count, which says how big it was
 * but nothing about how it went. The preview answers "was this the one where it
 * fixed the tests" without unfolding.
 */
export function turnPreview(turn: Turn, limit = 180): { prompt?: string; reply?: string } {
  const prompt = turn.prompt?.content.trim();
  const reply = turn.messages
    .find((message) => message.role === "assistant" && message.content.trim())
    ?.content.trim();
  const clip = (text: string | undefined) =>
    text ? (text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text) : undefined;
  return { prompt: clip(prompt), reply: clip(reply) };
}

/**
 * Hands back the turn objects from the previous render wherever the new ones
 * hold the same messages, and the previous array itself when nothing moved.
 *
 * `turnsFromMessages` builds fresh objects every call, and it is called on
 * every streamed frame. Without this, each frame hands every row a new `turn`
 * prop, so a memoized row re-renders the whole thread to append one message.
 */
export function reconcileTurns(previous: readonly Turn[], next: readonly Turn[]): Turn[] {
  let changed = previous.length !== next.length;
  const merged = next.map((turn, index) => {
    const before = previous[index];
    if (before && sameTurn(before, turn)) return before;
    changed = true;
    return turn;
  });
  return changed ? merged : (previous as Turn[]);
}

function sameTurn(a: Turn, b: Turn): boolean {
  if (a.id !== b.id || a.prompt !== b.prompt || a.messages.length !== b.messages.length) return false;
  return a.messages.every((message, index) => message === b.messages[index]);
}
