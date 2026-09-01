import type { ChatMessage } from "@capsule/shared";

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
