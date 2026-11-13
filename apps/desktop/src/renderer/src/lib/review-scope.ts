import type { Run } from "@capsule/shared";

/** What Review compares: the working tree against HEAD, or one saved turn. */
export type ReviewScope = { kind: "uncommitted" } | { kind: "turn"; runId: string };

export const UNCOMMITTED: ReviewScope = { kind: "uncommitted" };

export interface ReviewTurn {
  runId: string;
  /** 1-based position among the thread's turns, oldest first. */
  number: number;
  label: string;
}

const EXCERPT_CHARS = 48;

export function promptExcerpt(prompt: string): string {
  const line = prompt.replace(/\s+/g, " ").trim();
  if (!line) return "Untitled turn";
  return line.length > EXCERPT_CHARS ? `${line.slice(0, EXCERPT_CHARS - 1).trimEnd()}…` : line;
}

/** Turns that left a checkpoint, newest first, numbered by their place in the thread. */
export function reviewTurns(runs: readonly Run[]): ReviewTurn[] {
  const ordered = [...new Map(runs.map((run) => [run.id, run])).values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return ordered
    .map((run, index) => ({ run, number: index + 1 }))
    .filter(({ run }) => Boolean(run.checkpointRef))
    .map(({ run, number }) => ({ runId: run.id, number, label: `Turn ${number} · ${promptExcerpt(run.prompt)}` }))
    .reverse();
}

export function scopeValue(scope: ReviewScope): string {
  return scope.kind === "turn" ? `turn:${scope.runId}` : "uncommitted";
}

export function parseScopeValue(value: string): ReviewScope {
  return value.startsWith("turn:") && value.length > 5 ? { kind: "turn", runId: value.slice(5) } : UNCOMMITTED;
}

/*
 * Per-thread choices that last for this window's life, not across restarts:
 * reopening the app on an old turn's diff would read as the current state.
 */
const scopes = new Map<string, ReviewScope>();
const whitespace = new Map<string, boolean>();

export function rememberedScope(thread: string): ReviewScope {
  return scopes.get(thread) ?? UNCOMMITTED;
}

export function rememberScope(thread: string, scope: ReviewScope): void {
  if (scope.kind === "uncommitted") scopes.delete(thread);
  else scopes.set(thread, scope);
}

export function ignoreWhitespaceFor(thread: string, fallback: boolean): boolean {
  return whitespace.get(thread) ?? fallback;
}

export function rememberIgnoreWhitespace(thread: string, value: boolean, fallback: boolean): void {
  if (value === fallback) whitespace.delete(thread);
  else whitespace.set(thread, value);
}
