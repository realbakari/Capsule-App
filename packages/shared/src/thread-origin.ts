import { threadToMarkdown } from "./composer-context.js";
import type { HarnessId } from "./harness.js";
import type { ChatMessage } from "./types.js";

/** Agents whose own session history Capsule can read from disk. */
export const IMPORT_AGENT_IDS = ["claude", "codex"] as const satisfies readonly HarnessId[];
export type ImportAgentId = (typeof IMPORT_AGENT_IDS)[number];

export function isImportAgentId(value: unknown): value is ImportAgentId {
  return typeof value === "string" && (IMPORT_AGENT_IDS as readonly string[]).includes(value);
}

/**
 * How an imported thread's next message reaches an agent. `resume` reopens
 * the agent's own session by its id; `replay` starts a fresh session that is
 * handed the imported transcript once, as context.
 */
export type ImportContinuation = "resume" | "replay";

/** Where a thread came from, when it did not start as a blank conversation. Written once, at creation. */
export type ThreadOrigin =
  | {
    kind: "import";
    agent: ImportAgentId;
    nativeSessionId: string;
    continuation: ImportContinuation;
    /** Why the thread replays rather than resumes; absent on resume. */
    reason?: string;
    importedAt: string;
  }
  | {
    kind: "handoff";
    /** The thread this one continues. It is never changed. */
    sessionId: string;
    fromHarnessId?: HarnessId;
  }
  | {
    kind: "task";
    /** The thread whose agent created this card through the task tools. */
    sessionId: string;
  };

/** One session found in an agent's history, before it is imported. */
export interface ImportableSession {
  agent: ImportAgentId;
  nativeSessionId: string;
  cwd: string;
  title: string;
  firstPrompt: string;
  turnCount: number;
  /** ISO time of the newest entry. */
  lastActivity: string;
  /** What importing it now would give the thread. */
  continuation: ImportContinuation;
  reason?: string;
  /** The Capsule thread already made from it, if any. */
  importedAs?: string;
}

export interface ImportSource {
  agent: ImportAgentId;
  /** False when the agent's history folder does not exist on this computer. */
  found: boolean;
}

export interface ImportListing {
  sessions: ImportableSession[];
  sources: ImportSource[];
}

export interface ImportSessionInput {
  projectId: string;
  agent: ImportAgentId;
  nativeSessionId: string;
}

/**
 * Whether an imported session can be resumed. Only the direct route spawns
 * the agent's CLI on this computer, where its session files live; the
 * Gateway runs agent sessions of its own and cannot reopen one.
 */
export function importContinuation(route: "direct" | "gateway" | "mock"): { continuation: ImportContinuation; reason?: string } {
  if (route === "direct") return { continuation: "resume" };
  if (route === "gateway") return { continuation: "replay", reason: "The OpenClaw Gateway runs its own agent sessions and cannot reopen one started on this computer." };
  return { continuation: "replay", reason: "The mock runtime has no agent session to reopen." };
}

export interface HandoffInput {
  sessionId: string;
  harnessId: HarnessId;
  summary: string;
}

export const HANDOFF_SUMMARY_LIMIT = 24 * 1024;

/**
 * A starting summary for continuing a thread elsewhere, built from the
 * transcript: the prompts and final replies, newest kept when long. It is a
 * draft the user edits, not a promise of what the agent understood.
 */
export function handoffSummary(thread: { title: string; project?: string }, messages: readonly ChatMessage[]): string {
  return threadToMarkdown(thread, messages, HANDOFF_SUMMARY_LIMIT);
}

/** The summary as it rides ahead of the first prompt of the new thread. */
export function handoffContext(summary: string): string {
  return `<handoff-summary>\nThis conversation continues earlier work. The summary below describes it, for context; the request follows after.\n\n${summary.trim()}\n</handoff-summary>\n\n`;
}
