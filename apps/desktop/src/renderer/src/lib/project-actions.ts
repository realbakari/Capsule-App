import { useSyncExternalStore } from "react";
import type { ProjectAction } from "@capsule/shared";

/*
 * The action each project last ran, offered as the one-click button. A view
 * preference on this device: it lives in local storage and never reaches the
 * engine or the project file.
 */
const STORAGE_KEY = "capsule.lastProjectAction.v1";
const listeners = new Set<() => void>();
let cache: Record<string, string> | undefined;

function load(): Record<string, string> {
  if (cache) return cache;
  cache = {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object") {
      for (const [project, action] of Object.entries(parsed)) if (typeof action === "string") cache[project] = action;
    }
  } catch { /* Storage can be unavailable or hold an older shape. */ }
  return cache;
}

export function rememberLastAction(projectId: string, actionId: string): void {
  if (load()[projectId] === actionId) return;
  cache = { ...load(), [projectId]: actionId };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch { /* Keep the in-memory choice. */ }
  for (const listener of listeners) listener();
}

/** The last action run here while it still exists, else the first one. */
export function primaryAction(projectId: string | undefined, actions: readonly ProjectAction[]): ProjectAction | undefined {
  const last = projectId ? load()[projectId] : undefined;
  return actions.find((action) => action.id === last) ?? actions[0];
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrimaryAction(projectId: string | undefined, actions: readonly ProjectAction[]): ProjectAction | undefined {
  useSyncExternalStore(subscribe, () => (projectId ? load()[projectId] : undefined));
  return primaryAction(projectId, actions);
}
