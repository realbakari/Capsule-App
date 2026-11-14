import { useSyncExternalStore } from "react";
import { isDiffScope, type DiffScope, type Run } from "@capsule/shared";

/*
 * The Review scope each project last showed. It is a view preference on this
 * device, so it lives in local storage and never reaches the engine.
 */
const STORAGE_KEY = "capsule.reviewScope.v1";
const listeners = new Set<() => void>();
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
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReviewScope(projectId: string | undefined): DiffScope {
  return useSyncExternalStore(subscribe, () => reviewScope(projectId));
}

/** A conversation's newest turn, whatever state it is in. */
export function latestTurn(runs: readonly Run[], sessionId: string | undefined): Run | undefined {
  let latest: Run | undefined;
  for (const run of runs) {
    if (run.sessionId === sessionId && (!latest || run.createdAt > latest.createdAt)) latest = run;
  }
  return latest;
}
