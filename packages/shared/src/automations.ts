import type { AutomationConfig, Provenance } from "./config.js";
import { parseRRule, type RRule } from "./rrule.js";

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

export interface AutomationTemplate {
  id: string;
  label: string;
  automation: AutomationConfig;
}

/** Written paused, so nothing runs until the person has read and resumed it. */
export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: "triage",
    label: "Weekday issue triage",
    automation: {
      id: "triage-issues",
      name: "Triage new issues",
      schedule: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
      prompt: "Triage the issues opened since the last weekday: label each one, point out duplicates, and list the ones that need me.",
      enabled: false,
    },
  },
  {
    id: "nightly-command",
    label: "Nightly command in a worktree",
    automation: {
      id: "nightly-check",
      name: "Nightly check",
      schedule: "RRULE:FREQ=DAILY;BYHOUR=2;BYMINUTE=0",
      command: "flaky-tests",
      workspace: "worktree",
      enabled: false,
    },
  },
  {
    id: "every-five",
    label: "Every 5 minutes, for trying it out",
    automation: {
      id: "heartbeat",
      name: "Heartbeat",
      schedule: "RRULE:FREQ=MINUTELY;INTERVAL=5",
      prompt: "Say the time, and nothing else.",
      enabled: false,
    },
  },
];

export interface AutomationCreateInput {
  template: string;
  /** `user` runs in the Inbox; `local` belongs to one project and is yours alone. */
  scope: "user" | "local";
  projectId?: string;
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
