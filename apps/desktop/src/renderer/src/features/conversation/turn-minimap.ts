import type { Turn } from "../../lib/turns";
import { isCompactionTurn } from "./CompactionDivider";

/** One tick on the turn minimap: a prompt the reader can jump back to. */
export interface MinimapItem {
  turnId: string;
  /** The prompt's message id, which is what a jump locates. */
  messageId: string;
  /** 1-based among the ticks, as the label reads it. */
  number: number;
  prompt: string;
  /** The turn's last reply, for the hover preview. */
  reply?: string;
}

export interface TurnMinimapModel {
  items: MinimapItem[];
  /** The tick each turn's row belongs to: its own, or the prompt before it for a turn without one. */
  tickOf: ReadonlyMap<string, number>;
}

/** Below this many prompts there is nothing to navigate between. */
export const MINIMAP_MIN_ITEMS = 2;

const PREVIEW_LIMIT = 240;

/* The model rebuilds on every streamed frame; clip before collapsing so a long reply costs no more than a short one. */
const oneLine = (text: string | undefined) => {
  const line = text?.slice(0, PREVIEW_LIMIT * 4).replace(/\s+/gu, " ").trim();
  if (!line) return undefined;
  return line.length > PREVIEW_LIMIT ? `${line.slice(0, PREVIEW_LIMIT - 1).trimEnd()}…` : line;
};

/**
 * A tick per turn that opened with a prompt. A compaction turn renders as a
 * divider rather than a prompt, so it gets no tick of its own and reads as
 * part of the turn before it.
 */
export function turnMinimap(turns: readonly Turn[]): TurnMinimapModel {
  const items: MinimapItem[] = [];
  const tickOf = new Map<string, number>();
  for (const turn of turns) {
    if (turn.prompt && !isCompactionTurn(turn.prompt)) {
      const attachment = turn.prompt.attachments?.[0]?.name;
      items.push({
        turnId: turn.id,
        messageId: turn.prompt.id,
        number: items.length + 1,
        prompt: oneLine(turn.prompt.content) ?? (attachment ? `Attached ${attachment}` : "Empty prompt"),
        reply: oneLine(turn.messages.findLast((message) => message.role === "assistant" && message.content.trim())?.content),
      });
    }
    if (items.length) tickOf.set(turn.id, items.length - 1);
  }
  return { items, tickOf };
}

/** A mounted turn row, measured from the top of the transcript's viewport. */
export interface RowBox {
  turnId: string;
  top: number;
  bottom: number;
}

/**
 * Where reading happens. A jump lands its turn 48px below the top, so a row
 * starting below this line is one the reader was taken to or is about to reach.
 */
export const READ_LINE = 24;

export interface MinimapView {
  /** Ticks whose turn has any part on screen. */
  inView: number[];
  /** The turn being read, which Previous and Next step from. */
  current: number | null;
}

/**
 * Rows arrive in turn order. The current tick is the first prompt that starts
 * on screen below the read line, else the turn whose row crosses it.
 */
export function minimapView(model: TurnMinimapModel, rows: readonly RowBox[], viewportHeight: number): MinimapView {
  const inView = new Set<number>();
  let firstPrompt: number | null = null;
  let reading: number | null = null;
  for (const row of rows) {
    const tick = model.tickOf.get(row.turnId);
    if (tick === undefined) continue;
    if (row.bottom > 0 && row.top < viewportHeight) inView.add(tick);
    if (row.top < READ_LINE) reading = tick;
    else if (firstPrompt === null && row.top < viewportHeight && model.items[tick]?.turnId === row.turnId) firstPrompt = tick;
  }
  return { inView: [...inView].sort((a, b) => a - b), current: firstPrompt ?? reading };
}
