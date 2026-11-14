import { isHarnessId, type HarnessId, type HarnessPermissionProfile } from "./harness.js";
import type { MessageAttachment, RunStatus, VerificationState } from "./types.js";

/**
 * Best-of-N: one prompt, run on several agents at once, each in its own
 * worktree thread, so the person can compare what came back and keep one.
 *
 * A group is only the comparison's own facts: the prompt, when it ran, and
 * which candidate was kept. The candidates are ordinary threads that carry
 * the group's id, so everything a thread already does (its route, its agent
 * session, its worktree, its turns) works on them unchanged.
 */
export interface ThreadGroup {
  id: string;
  projectId: string;
  kind: "best-of-n";
  prompt: string;
  /**
   * Who ran, in the order they were asked for. Kept on the group as well as
   * on the threads so the leaderboard still counts a comparison whose
   * threads were later deleted.
   */
  candidates: GroupCandidate[];
  createdAt: string;
  /** The candidate whose changes were applied to the project folder. */
  winnerSessionId?: string;
  decidedAt?: string;
}

export interface GroupCandidate {
  sessionId: string;
  harnessId: string;
  /** "" for the agent's default model. */
  model: string;
}

export const BEST_OF_N_MIN = 2;
export const BEST_OF_N_MAX = 4;
export const BEST_OF_N_PROMPT_LIMIT = 200_000;

export interface BestOfNCandidate {
  harnessId: HarnessId;
  /** Absent: the agent's own default model. */
  model?: string;
}

export interface StartBestOfNInput {
  projectId: string;
  prompt: string;
  attachments?: MessageAttachment[];
  candidates: BestOfNCandidate[];
  permissionProfile?: HarnessPermissionProfile;
}

export interface StartBestOfNResult {
  group: ThreadGroup;
  /** In the order the candidates were asked for. The prompts are on their way when this returns. */
  sessionIds: string[];
}

/** How one candidate stands, read in one pass for the Compare surface. */
export interface CandidateSummary {
  sessionId: string;
  title: string;
  harnessId?: string;
  model?: string;
  route?: "direct" | "gateway";
  branch?: string;
  archived: boolean;
  /** "set-aside": archived with its worktree saved and removed; restoring the thread brings it back. */
  worktree: "present" | "set-aside" | "missing";
  run?: { id: string; status: RunStatus; createdAt: string; completedAt?: string; error?: string };
  /** The prompt never reached this candidate, and why. Its thread stays so it can be sent by hand. */
  startError?: string;
  diff?: { files: CandidateFileStat[]; added: number; removed: number } | { error: string };
  verification?: VerificationState;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cost?: { amount: number; currency: string } };
  /** The start of the final reply, or undefined before there is one. */
  reply?: string;
  rating?: RatingValue;
}

export interface CandidateFileStat {
  path: string;
  added: number;
  removed: number;
}

export interface GroupComparison {
  group: ThreadGroup;
  candidates: CandidateSummary[];
}

export type CandidatePhase = "starting" | "running" | "needs-you" | "done" | "failed" | "stopped";

/** One word for where a candidate is, from its latest turn. */
export function candidatePhase(candidate: Pick<CandidateSummary, "run" | "startError">): CandidatePhase {
  const status = candidate.run?.status;
  if (!status) return candidate.startError ? "failed" : "starting";
  if (status === "approval_required" || status === "blocked") return "needs-you";
  if (status === "completed") return "done";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "stopped";
  return "running";
}

/** A second keep would stack two candidates' changes in one checkout. */
export const ANOTHER_KEPT = "Another candidate is kept. Undo its apply to keep this one instead.";

/** Why "Keep this one" cannot run for a candidate, or undefined when it can. */
export function keepBlocker(group: ThreadGroup, candidate: CandidateSummary): string | undefined {
  if (group.winnerSessionId === candidate.sessionId) return "Already kept.";
  if (group.winnerSessionId) return ANOTHER_KEPT;
  if (candidate.archived) return "Restore this thread first.";
  if (candidate.worktree !== "present") return "This candidate's worktree is missing.";
  const phase = candidatePhase(candidate);
  if (phase === "starting" || phase === "running") return "Wait for this candidate to finish.";
  if (candidate.diff && "files" in candidate.diff && candidate.diff.files.length === 0) return "This candidate changed no files.";
  return undefined;
}

/** "Fix the login bug · Codex/gpt-5" */
export function candidateTitle(promptTitle: string, agentName: string, model?: string): string {
  return `${promptTitle} · ${model ? `${agentName}/${model}` : agentName}`;
}

/* --- Ratings and the personal leaderboard ------------------------------ */

export type RatingValue = 1 | -1;

/** A thumbs up or down on one turn's final reply, kept on this computer only. */
export interface RunRating {
  runId: string;
  sessionId: string;
  harnessId: string;
  /** "" when the agent's default model answered. */
  model: string;
  value: RatingValue;
  createdAt: string;
}

/** One candidate's part in a comparison, for the leaderboard. */
export interface ComparisonEntry {
  harnessId: string;
  model: string;
  kept: boolean;
}

export interface LeaderboardRow {
  harnessId: string;
  model: string;
  /** Comparisons this agent and model took part in. */
  compared: number;
  /** Comparisons where its result was kept. */
  kept: number;
  up: number;
  down: number;
}

/**
 * Totals per agent and model, best first: most kept, then the best thumbs
 * balance, then the most used. Ties keep a stable name order so the table
 * does not shuffle between reads.
 */
export function aggregateLeaderboard(entries: readonly ComparisonEntry[], ratings: ReadonlyArray<Pick<RunRating, "harnessId" | "model" | "value">>): LeaderboardRow[] {
  const rows = new Map<string, LeaderboardRow>();
  const row = (harnessId: string, model: string) => {
    const key = JSON.stringify([harnessId, model]);
    let found = rows.get(key);
    if (!found) rows.set(key, found = { harnessId, model, compared: 0, kept: 0, up: 0, down: 0 });
    return found;
  };
  for (const entry of entries) {
    const target = row(entry.harnessId, entry.model);
    target.compared += 1;
    if (entry.kept) target.kept += 1;
  }
  for (const rating of ratings) {
    const target = row(rating.harnessId, rating.model);
    if (rating.value === 1) target.up += 1;
    else target.down += 1;
  }
  return [...rows.values()].sort((a, b) =>
    b.kept - a.kept
    || (b.up - b.down) - (a.up - a.down)
    || b.compared + b.up + b.down - (a.compared + a.up + a.down)
    || a.harnessId.localeCompare(b.harnessId)
    || a.model.localeCompare(b.model));
}

/* --- IPC boundary -------------------------------------------------------- */

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

/** Validate a start request that arrived over IPC. Attachments are checked again where the files are read. */
export function readStartBestOfN(value: unknown): StartBestOfNInput | undefined {
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input !== "object") return undefined;
  const projectId = text(input.projectId, 256);
  const prompt = text(input.prompt, BEST_OF_N_PROMPT_LIMIT);
  if (!projectId || prompt === undefined) return undefined;
  if (!Array.isArray(input.candidates) || input.candidates.length < BEST_OF_N_MIN || input.candidates.length > BEST_OF_N_MAX) return undefined;
  const candidates: BestOfNCandidate[] = [];
  for (const raw of input.candidates as unknown[]) {
    const candidate = raw as Record<string, unknown> | null;
    const harnessId = candidate && typeof candidate === "object" ? text(candidate.harnessId, 64) : undefined;
    if (!harnessId || !isHarnessId(harnessId)) return undefined;
    const model = candidate!.model === undefined ? undefined : text(candidate!.model, 256)?.trim();
    if (candidate!.model !== undefined && model === undefined) return undefined;
    candidates.push({ harnessId, ...(model ? { model } : {}) });
  }
  const attachments = input.attachments === undefined ? [] : Array.isArray(input.attachments) ? input.attachments as MessageAttachment[] : undefined;
  if (!attachments) return undefined;
  if (!prompt.trim() && attachments.length === 0) return undefined;
  const profile = input.permissionProfile;
  const permissionProfile = profile === "strict" || profile === "approve-all" || profile === "default" ? profile : undefined;
  if (profile !== undefined && !permissionProfile) return undefined;
  return { projectId, prompt, candidates, ...(attachments.length ? { attachments } : {}), ...(permissionProfile ? { permissionProfile } : {}) };
}

export function readRatingValue(value: unknown): RatingValue | 0 | undefined {
  return value === 1 || value === -1 || value === 0 ? value : undefined;
}
