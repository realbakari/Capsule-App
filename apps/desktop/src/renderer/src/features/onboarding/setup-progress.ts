import { useSyncExternalStore } from "react";
import type { CapsuleSettings, HarnessStatus } from "@capsule/shared";

/*
 * How far a new user is through setup. `firstRunDone` in settings says the
 * first run was finished or put off. Whether the checklist that follows a
 * put-off first run is still wanted is a sidebar convenience on this
 * computer, so that one mark lives in the window's own storage.
 */
export interface SetupMarks {
  /** First run was opened and the checklist has not been finished or dismissed. */
  pending: boolean;
}

export type SetupItemId = "agent" | "folder";
export interface SetupItem { id: SetupItemId; label: string; done: boolean }

const READY = new Set<HarnessStatus["readiness"]>(["ready", "dedicated", "running"]);

export function agentIsReady(harness: HarnessStatus): boolean {
  return READY.has(harness.readiness);
}

export function setupChecklist(input: { harnesses: HarnessStatus[]; projectCount: number }): SetupItem[] {
  return [
    { id: "agent", label: "An agent is ready", done: input.harnesses.some(agentIsReady) },
    { id: "folder", label: "A folder is added", done: input.projectCount > 0 },
  ];
}

/**
 * The agent the first conversation starts with. The one already picked stays
 * when it is ready. A picked agent that is not one of these presets (a Gateway
 * agent, or the mock runtime's) is left alone. Otherwise the first ready
 * featured agent, then any ready one, so the first message does not land on an
 * agent that is not installed while another one is ready.
 */
export function firstRunAgent(harnesses: HarnessStatus[], pickedId: string | undefined): HarnessStatus | undefined {
  const picked = harnesses.find((item) => item.id === pickedId);
  if (pickedId && !picked) return undefined;
  if (picked && agentIsReady(picked)) return picked;
  const ready = harnesses.filter(agentIsReady);
  return ready.find((item) => item.featured) ?? ready[0];
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
const NO_MARKS: SetupMarks = { pending: false };
let marks: SetupMarks | undefined;
const listeners = new Set<() => void>();

function readMarks(): SetupMarks {
  if (marks) return marks;
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<SetupMarks> | null;
    marks = { pending: stored?.pending === true };
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

/** Opens first run from anywhere: the palette, or a line of the setup checklist. */
export function requestFirstRun(): void {
  window.dispatchEvent(new CustomEvent(FIRST_RUN_EVENT));
}

export function onFirstRunRequest(listener: () => void): () => void {
  window.addEventListener(FIRST_RUN_EVENT, listener);
  return () => window.removeEventListener(FIRST_RUN_EVENT, listener);
}
