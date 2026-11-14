import type { HarnessId } from "./harness.js";

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
  {
    kind: "import";
    agent: ImportAgentId;
    nativeSessionId: string;
    continuation: ImportContinuation;
    /** Why the thread replays rather than resumes; absent on resume. */
    reason?: string;
    importedAt: string;
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
