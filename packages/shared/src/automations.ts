import type { AutomationConfig, Provenance } from "./config.js";
import { parseRRule, type RRule, type Weekday } from "./rrule.js";

export type AutomationRunStatus = "running" | "completed" | "failed";

export interface AutomationLastRun {
  at: string;
  trigger: "schedule" | "manual";
  status: AutomationRunStatus;
  sessionId?: string;
  runId?: string;
  finishedAt?: string;
  /** Why it failed, in a sentence. */
  detail?: string;
}

/** Occurrences that passed while Capsule was closed or asleep. They wait for the person; nothing replays them. */
export interface AutomationMissed {
  count: number;
  first: string;
  last: string;
}

/** One automation as the renderer sees it: the file's entry plus what the scheduler knows. */
export interface AutomationView {
  /** Unique across files: the project for a project's automation, `user` for yours. */
  key: string;
  id: string;
  name: string;
  schedule: string;
  /** The schedule in words. Absent when it does not parse. */
  scheduleText?: string;
  /** Why it cannot run: a schedule that does not parse, or neither or both of prompt and command. */
  problem?: string;
  prompt?: string;
  command?: string;
  profile?: string;
  workspace?: "local" | "worktree";
  enabled: boolean;
  source: Provenance;
  /** Where its threads go. Absent for yours, which run in the Inbox. */
  projectId?: string;
  nextRunAt?: string;
  lastRun?: AutomationLastRun;
  /** The last occurrence skipped because the previous run was still going. */
  skippedAt?: string;
  missed?: AutomationMissed;
  running: boolean;
}

export function automationKey(projectId: string | undefined, id: string): string {
  return `${projectId ?? "user"}:${id}`;
}

/** The rule to schedule by, or why there is none. */
export function readAutomation(automation: AutomationConfig): { ok: true; rule: RRule } | { ok: false; message: string } {
  const hasPrompt = Boolean(automation.prompt?.trim());
  const hasCommand = Boolean(automation.command?.trim());
  if (hasPrompt === hasCommand) return { ok: false, message: "Give exactly one of prompt or command." };
  const parsed = parseRRule(automation.schedule);
  return parsed.ok ? parsed : { ok: false, message: parsed.message };
}

/** What a run sends: the prompt, or the command as the person would type it. */
export function automationMessage(automation: AutomationConfig): string {
  if (automation.prompt?.trim()) return automation.prompt.trim();
  const command = (automation.command ?? "").trim();
  return command.startsWith("/") ? command : `/${command}`;
}

/** What Settings → Automations → New automation fills in. The id comes from the name. */
export interface AutomationDraft {
  name: string;
  /** An RRULE, usually built by `scheduleRule`. */
  schedule: string;
  /** Sent as if typed, so a leading `/command` expands as it would in the composer. */
  prompt: string;
  /** Only for a project's automation; the Inbox has no repository. */
  workspace?: "worktree";
}

export interface AutomationCreateInput {
  draft: AutomationDraft;
  /** `user` runs in the Inbox; `local` belongs to one project and is yours alone. */
  scope: "user" | "local";
  projectId?: string;
}

/** The entry a draft becomes, on, or the first thing wrong with it in a sentence. */
export function automationFromDraft(draft: AutomationDraft): { ok: true; automation: AutomationConfig } | { ok: false; message: string } {
  const name = draft.name.trim();
  if (!name) return { ok: false, message: "Give it a name." };
  const prompt = draft.prompt.trim();
  if (!prompt) return { ok: false, message: "Write what it should send." };
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "automation";
  const automation: AutomationConfig = { id, name, schedule: draft.schedule.trim(), prompt, ...(draft.workspace ? { workspace: draft.workspace } : {}), enabled: true };
  const read = readAutomation(automation);
  return read.ok ? { ok: true, automation } : { ok: false, message: read.message };
}

/** The schedules the form offers. Anything else is written in the settings file. */
export type ScheduleChoice =
  | { kind: "minutes"; every: number }
  | { kind: "hourly" }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; day: Weekday; hour: number; minute: number };

export function scheduleRule(choice: ScheduleChoice): string {
  const at = (hour: number, minute: number) => `BYHOUR=${hour};BYMINUTE=${minute}`;
  switch (choice.kind) {
    case "minutes": return `RRULE:FREQ=MINUTELY;INTERVAL=${choice.every}`;
    case "hourly": return "RRULE:FREQ=HOURLY;BYMINUTE=0";
    case "daily": return `RRULE:FREQ=DAILY;${at(choice.hour, choice.minute)}`;
    case "weekdays": return `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;${at(choice.hour, choice.minute)}`;
    case "weekly": return `RRULE:FREQ=WEEKLY;BYDAY=${choice.day};${at(choice.hour, choice.minute)}`;
  }
}

export interface AutomationEnabledInput {
  key: string;
  enabled: boolean;
  projectId?: string;
}

export interface AutomationKeyInput {
  key: string;
  projectId?: string;
}
