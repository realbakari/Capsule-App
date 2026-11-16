import { useSyncExternalStore } from "react";
import type { CapsuleSettings, HarnessStatus } from "@capsule/shared";

/*
 * How far a new user is through setup. `firstRunDone` in settings says the
 * first run was finished or put off. The checklist that follows a put-off
 * first run is a sidebar convenience on this computer, so its two marks live
 * in the window's own storage: whether the checklist is still wanted, and
 * whether notifications were looked at, which no setting can tell apart from
 * the default.
 */
export interface SetupMarks {
  /** First run was opened and the checklist has not been finished or dismissed. */
  pending: boolean;
  notificationsChosen: boolean;
}

export type SetupItemId = "agent" | "folder" | "notifications";
export interface SetupItem { id: SetupItemId; label: string; done: boolean }

const READY = new Set<HarnessStatus["readiness"]>(["ready", "dedicated", "running"]);

export function agentIsReady(harness: HarnessStatus): boolean {
  return READY.has(harness.readiness);
}

export function setupChecklist(input: { harnesses: HarnessStatus[]; projectCount: number; notificationsChosen: boolean }): SetupItem[] {
  return [
    { id: "agent", label: "An agent is ready", done: input.harnesses.some(agentIsReady) },
    { id: "folder", label: "A folder is added", done: input.projectCount > 0 },
    { id: "notifications", label: "Notifications are chosen", done: input.notificationsChosen },
  ];
}

/**
 * First run opens by itself only for a profile that has never finished or put
 * it off and has no projects yet. An existing profile has projects, and a
 * paired device cannot run installs or sign-ins, so neither ever sees it.
 */
export function shouldOpenFirstRun(input: { desktop: boolean; settings?: Pick<CapsuleSettings, "firstRunDone">; projectCount: number }): boolean {
  return input.desktop && input.settings?.firstRunDone === false && input.projectCount === 0;
}

export function checklistVisible(input: { desktop: boolean; marks: SetupMarks; items: SetupItem[] }): boolean {
  return input.desktop && input.marks.pending && input.items.some((item) => !item.done);
}

const STORAGE_KEY = "capsule.setupChecklist";
const NO_MARKS: SetupMarks = { pending: false, notificationsChosen: false };
let marks: SetupMarks | undefined;
const listeners = new Set<() => void>();

function readMarks(): SetupMarks {
  if (marks) return marks;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<SetupMarks> | null;
    marks = { pending: stored?.pending === true, notificationsChosen: stored?.notificationsChosen === true };
  } catch {
    marks = NO_MARKS;
  }
  return marks;
}

export function updateSetupMarks(patch: Partial<SetupMarks>): void {
  marks = { ...readMarks(), ...patch };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(marks)); } catch { /* Storage can be unavailable; the marks still hold for this window. */ }
  for (const listener of listeners) listener();
}

export function useSetupMarks(): SetupMarks {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, readMarks);
}

const FIRST_RUN_EVENT = "capsule:open-first-run";

/** Opens first run from anywhere: the palette, or a checklist line at its own step. */
export function requestFirstRun(at?: SetupItemId): void {
  window.dispatchEvent(new CustomEvent<{ at?: SetupItemId }>(FIRST_RUN_EVENT, { detail: { at } }));
}

export function onFirstRunRequest(listener: (at?: SetupItemId) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<{ at?: SetupItemId }>).detail?.at);
  window.addEventListener(FIRST_RUN_EVENT, handle);
  return () => window.removeEventListener(FIRST_RUN_EVENT, handle);
}
