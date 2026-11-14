import { useSyncExternalStore } from "react";
import { isDiffScope, type DiffScope, type GitDiffScope, type Run } from "@capsule/shared";

/*
 * The Review scope each project last showed. It is a view preference on this
 * device, so it lives in local storage and never reaches the engine.
 */
const STORAGE_KEY = "capsule.reviewScope.v1";
const listeners = new Set<() => void>();
/* Bumped by every choice below, so one subscription sees the project scope, the thread's turn and whitespace. */
let version = 0;
let cache: Record<string, DiffScope> | undefined;

function load(): Record<string, DiffScope> {
  if (cache) return cache;
  cache = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object") {
      for (const [project, scope] of Object.entries(parsed)) if (isDiffScope(scope)) cache[project] = scope;
    }
  } catch { /* Storage can be unavailable or hold an older shape. */ }
  return cache;
}

export function reviewScope(projectId: string | undefined): DiffScope {
  return (projectId && load()[projectId]) || "uncommitted";
}

export function setReviewScope(projectId: string, scope: DiffScope): void {
  cache = { ...load(), [projectId]: scope };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch { /* Keep the in-memory choice. */ }
  notify();
}

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReviewScope(projectId: string | undefined): DiffScope {
  return useSyncExternalStore(subscribe, () => reviewScope(projectId));
}

/** Re-renders whenever any Review choice changes. */
export function useReviewChoices(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** A conversation's newest turn, whatever state it is in. */
export function latestTurn(runs: readonly Run[], sessionId: string | undefined): Run | undefined {
  let latest: Run | undefined;
  for (const run of runs) {
    if (run.sessionId === sessionId && (!latest || run.createdAt > latest.createdAt)) latest = run;
  }
  return latest;
}
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
  notify();
}

export function ignoreWhitespaceFor(thread: string, fallback: boolean): boolean {
  return whitespace.get(thread) ?? fallback;
}

export function rememberIgnoreWhitespace(thread: string, value: boolean, fallback: boolean): void {
  if (value === fallback) whitespace.delete(thread);
  else whitespace.set(thread, value);
  notify();
}

/** What Review shows: one of git's scopes, or one saved turn (absent while none is saved). */
export type ReviewSelection = { kind: GitDiffScope } | { kind: "turn"; runId?: string };

/*
 * The project's scope says which kind of diff; for a turn, the thread's own
 * pick wins while it is still a saved turn, else the newest one. While the
 * turn list loads, a remembered pick is kept rather than dropped.
 */
export function reviewSelection(kind: DiffScope, thread: string, turns: readonly ReviewTurn[], loading: boolean): ReviewSelection {
  if (kind !== "turn") return { kind };
  const picked = rememberedScope(thread);
  if (picked.kind === "turn" && (loading || turns.some((turn) => turn.runId === picked.runId))) return { kind: "turn", runId: picked.runId };
  return { kind: "turn", runId: turns[0]?.runId };
}

export function selectionValue(selection: ReviewSelection): string {
  return selection.kind === "turn" ? (selection.runId ? `turn:${selection.runId}` : "turn") : selection.kind;
}

/** Apply a choice from Review's scope select. */
export function chooseReview(projectId: string, thread: string, value: string): void {
  const scope = parseScopeValue(value);
  if (scope.kind === "turn") {
    rememberScope(thread, scope);
    setReviewScope(projectId, "turn");
    return;
  }
  rememberScope(thread, UNCOMMITTED);
  setReviewScope(projectId, isDiffScope(value) ? value : "uncommitted");
}
