import type { RunEvent } from "@capsule/shared";
import { activityFromEvents } from "./activity";

/** Asked for from the command palette before the board is on screen. */
export const NEW_BOARD_CARD_EVENT = "capsule:new-board-card";
let newCardRequested = false;

export function requestNewBoardCard(): void {
  newCardRequested = true;
  window.dispatchEvent(new CustomEvent(NEW_BOARD_CARD_EVENT));
}

export function takeNewBoardCardRequest(): boolean {
  const requested = newCardRequested;
  newCardRequested = false;
  return requested;
}

export type BoardScope = "project" | "all";
export const BOARD_SCOPE_KEY = "capsule.boardScope";

export function readBoardScope(read: () => string | null): BoardScope {
  try { return read() === "all" ? "all" : "project"; }
  catch { return "project"; }
}

export type BoardKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/**
 * The card arrow keys move to. Up and down stay in the column; left and right
 * skip empty columns and land on the nearest row, so focus never disappears
 * into a column with nothing in it.
 */
export function moveBoardFocus(columns: readonly (readonly string[])[], current: string | undefined, key: BoardKey): string | undefined {
  const first = columns.find((column) => column.length > 0)?.[0];
  if (!current) return first;
  const col = columns.findIndex((column) => column.includes(current));
  if (col < 0) return first;
  const row = columns[col]!.indexOf(current);
  if (key === "ArrowUp") return columns[col]![Math.max(0, row - 1)];
  if (key === "ArrowDown") return columns[col]![Math.min(columns[col]!.length - 1, row + 1)];
  const step = key === "ArrowLeft" ? -1 : 1;
  for (let next = col + step; next >= 0 && next < columns.length; next += step) {
    const column = columns[next]!;
    if (column.length > 0) return column[Math.min(row, column.length - 1)];
  }
  return current;
}

/** The newest thing a card's agent did, in one line: the last tool call or message. */
export function latestStep(events: RunEvent[], finished: boolean): string | undefined {
  const phase = activityFromEvents(events, finished).at(-1);
  if (!phase) return undefined;
  const line = (phase.detail ?? phase.label).split("\n").find((part) => part.trim())?.trim();
  return line && line !== phase.label && phase.detail ? `${phase.label} · ${line}` : line;
}

/** The first line of a draft's prompt, for a card that has not done anything yet. */
export function promptPreview(prompt: string): string {
  return prompt.split("\n").find((line) => line.trim())?.trim() ?? "";
}
