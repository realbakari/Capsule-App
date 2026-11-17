import { useSyncExternalStore } from "react";
import { isDiffScope, type DiffScope, type ReviewCommit, type Run } from "@capsule/shared";

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

/*
 * The ref Branch measures from, per project on this device. Absent, the
 * engine uses the default branch; a base that stops resolving falls back too.
 */
const BASE_KEY = "capsule.reviewBase.v1";
let bases: Record<string, string> | undefined;

function loadBases(): Record<string, string> {
  if (bases) return bases;
  bases = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BASE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object") {
      for (const [project, base] of Object.entries(parsed)) if (typeof base === "string" && base) bases[project] = base;
    }
  } catch { /* Storage can be unavailable or hold an older shape. */ }
  return bases;
}

export function reviewBase(projectId: string | undefined): string | undefined {
  return projectId ? loadBases()[projectId] : undefined;
}

export function setReviewBase(projectId: string, base: string | undefined): void {
  const { [projectId]: _previous, ...rest } = loadBases();
  bases = base ? { ...rest, [projectId]: base } : rest;
  try { localStorage.setItem(BASE_KEY, JSON.stringify(bases)); } catch { /* Keep the in-memory choice. */ }
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
const commitPicks = new Map<string, string>();

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

/**
 * What Review shows: one of git's scopes, Branch against a base (absent: the
 * default branch), one commit, or one saved turn (absent while none exists).
 */
export type ReviewSelection =
  | { kind: "uncommitted" | "staged" | "unstaged" }
  | { kind: "branch"; base?: string }
  | { kind: "commit"; oid?: string }
  | { kind: "turn"; runId?: string };

export interface ReviewCommits {
  commits: readonly ReviewCommit[];
  loading: boolean;
}

/*
 * The project's scope says which kind of diff; for a turn, the thread's own
 * pick wins while it is still a saved turn, else the newest one. While the
 * turn list loads, a remembered pick is kept rather than dropped.
 */
export function reviewSelection(kind: DiffScope, thread: string, turns: readonly ReviewTurn[], loading: boolean, projectId?: string, commits: ReviewCommits = { commits: [], loading: false }): ReviewSelection {
  if (kind === "branch") return { kind, base: reviewBase(projectId) };
  if (kind === "commit") {
    const picked = commitPicks.get(thread);
    if (picked && (commits.loading || commits.commits.some((commit) => commit.oid === picked))) return { kind, oid: picked };
    return { kind, oid: commits.commits[0]?.oid };
  }
  if (kind !== "turn") return { kind };
  const picked = rememberedScope(thread);
  if (picked.kind === "turn" && (loading || turns.some((turn) => turn.runId === picked.runId))) return { kind: "turn", runId: picked.runId };
  return { kind: "turn", runId: turns[0]?.runId };
}

export function selectionValue(selection: ReviewSelection): string {
  if (selection.kind === "turn") return selection.runId ? `turn:${selection.runId}` : "turn";
  if (selection.kind === "commit") return selection.oid ? `commit:${selection.oid}` : "commit";
  return selection.kind;
}

/** Apply a choice from Review's scope select. */
export function chooseReview(projectId: string, thread: string, value: string): void {
  if (value === "commit" || value.startsWith("commit:")) {
    if (value.length > 7) commitPicks.set(thread, value.slice(7));
    setReviewScope(projectId, "commit");
    return;
  }
  const scope = parseScopeValue(value);
  if (scope.kind === "turn") {
    rememberScope(thread, scope);
    setReviewScope(projectId, "turn");
    return;
  }
  rememberScope(thread, UNCOMMITTED);
  setReviewScope(projectId, isDiffScope(value) ? value : "uncommitted");
}

const CHANGE_WORDS: Record<string, string> = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied", T: "Type changed" };

/**
 * A changed file's porcelain code (`XY`: index, then working tree) as one
 * letter and the words for it. Git's `??` reads as U for untracked, as in
 * most editors, and the title says whether the change is staged.
 */
export function changeStatus(code: string): { letter: string; title: string } {
  const [index = " ", tree = " "] = code;
  if (code.startsWith("??")) return { letter: "U", title: "Untracked: new and not added to Git yet" };
  if (index === "U" || tree === "U" || code === "AA" || code === "DD") return { letter: "!", title: "Conflicted: resolve the merge before committing" };
  const kind = index !== " " ? index : tree;
  const word = CHANGE_WORDS[kind] ?? "Changed";
  const staging = index !== " " && tree !== " " ? "partly staged" : index !== " " ? "staged" : "not staged";
  return { letter: kind, title: `${word}, ${staging}` };
}

/** A commit as the scope list names it: its subject, then its short ID. */
export function commitLabel(commit: ReviewCommit): string {
  return `${promptExcerpt(commit.subject || "No subject")} · ${commit.oid.slice(0, 7)}`;
}

const TEST_FOLDERS = new Set(["__tests__", "__mocks__", "test", "tests", "spec", "specs", "e2e", "testing"]);
const TEST_NAME = /(?:[._-](?:test|spec|e2e)s?\.[^.]+$|^test_.+\.py$|_test\.(?:go|py|rb|exs?)$|_spec\.rb$|(?:Tests?|Spec)\.(?:java|kt|swift|cs|scala)$)/;

/** Whether a path looks like a test, a fixture folder of tests, or a test helper, by common conventions. */
export function isTestPath(path: string): boolean {
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  return parts.some((part) => TEST_FOLDERS.has(part)) || TEST_NAME.test(name);
}

/*
 * Whether Review hides test files, per thread for this window's life like
 * the whitespace choice.
 */
const hideTests = new Set<string>();

export function hidesTests(thread: string): boolean {
  return hideTests.has(thread);
}

export function rememberHideTests(thread: string, value: boolean): void {
  if (value) hideTests.add(thread); else hideTests.delete(thread);
  notify();
}
