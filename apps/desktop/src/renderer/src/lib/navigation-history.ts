/**
 * Where the user has been: a bounded list of (project, conversation)
 * selections with a cursor, so Back returns to the previous conversation the
 * way a browser returns to the previous page. Recording the same place twice
 * in a row is a no-op, and moving somewhere new after going back discards
 * the forward entries, as a browser does.
 */

export interface NavigationEntry {
  projectId?: string;
  sessionId?: string;
}

export interface NavigationHistory {
  entries: NavigationEntry[];
  index: number;
}

export const EMPTY_NAVIGATION: NavigationHistory = { entries: [], index: -1 };
const LIMIT = 50;

export function sameEntry(a: NavigationEntry | undefined, b: NavigationEntry | undefined): boolean {
  return a?.projectId === b?.projectId && a?.sessionId === b?.sessionId;
}

export function recordNavigation(history: NavigationHistory, entry: NavigationEntry): NavigationHistory {
  if (!entry.projectId && !entry.sessionId) return history;
  if (sameEntry(history.entries[history.index], entry)) return history;
  const entries = [...history.entries.slice(0, history.index + 1), entry].slice(-LIMIT);
  return { entries, index: entries.length - 1 };
}

export function canGoBack(history: NavigationHistory): boolean {
  return history.index > 0;
}

export function canGoForward(history: NavigationHistory): boolean {
  return history.index >= 0 && history.index < history.entries.length - 1;
}

export function goBack(history: NavigationHistory): { history: NavigationHistory; entry: NavigationEntry } | undefined {
  if (!canGoBack(history)) return undefined;
  const index = history.index - 1;
  return { history: { ...history, index }, entry: history.entries[index]! };
}

export function goForward(history: NavigationHistory): { history: NavigationHistory; entry: NavigationEntry } | undefined {
  if (!canGoForward(history)) return undefined;
  const index = history.index + 1;
  return { history: { ...history, index }, entry: history.entries[index]! };
}

/** A deleted or archived conversation drops out; the cursor stays on a surviving entry. */
export function pruneNavigation(history: NavigationHistory, keep: (entry: NavigationEntry) => boolean): NavigationHistory {
  const current = history.entries[history.index];
  const entries = history.entries.filter(keep).filter((entry, index, all) => index === 0 || !sameEntry(all[index - 1], entry));
  if (entries.length === history.entries.length) return history;
  if (entries.length === 0) return EMPTY_NAVIGATION;
  // A removed current place leaves the cursor on the nearest surviving place before it.
  const keptBefore = history.entries.slice(0, history.index + 1).filter(keep).length;
  const index = current && keep(current) ? entries.findIndex((entry) => sameEntry(entry, current)) : Math.max(0, keptBefore - 1);
  return { entries, index };
}
