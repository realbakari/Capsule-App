import type { Run } from "./types.js";

export interface RunHistoryCursor { createdAt: string; id: string }
export interface RunHistoryQuery {
  sessionId?: string;
  projectId?: string;
  before?: RunHistoryCursor;
  limit?: number;
}
export interface RunHistoryPage { runs: Run[]; hasMore: boolean; before?: RunHistoryCursor }

/** History and sidebar rows need identity/status, never complete answer bodies. */
export function summarizeRun(run: Run): Run {
  const { result, ...summary } = run;
  return { ...summary, prompt: run.prompt.slice(0, 512), hasResult: run.hasResult ?? Boolean(result?.trim()) };
}
