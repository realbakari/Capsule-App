import type { Run } from "@capsule/shared";

export type BackgroundNews = "finished" | "failed" | "needs-approval";

const NEWS: Partial<Record<Run["status"], BackgroundNews>> = {
  completed: "finished",
  failed: "failed",
  approval_required: "needs-approval",
  blocked: "needs-approval",
};

/**
 * What changed in other threads between two snapshots of the latest runs.
 *
 * A change counts, and so does a run first seen already settled if it
 * settled after `since` (a fast turn can start and finish between two
 * updates). Anything older is history being loaded, not news. The open
 * thread is left out because you are looking at it.
 */
export function backgroundNews(
  previous: ReadonlyMap<string, Pick<Run, "status">>,
  runs: ReadonlyArray<Pick<Run, "id" | "sessionId" | "status"> & Partial<Pick<Run, "updatedAt" | "completedAt">>>,
  openSessionId: string | undefined,
  since: string,
): Array<{ runId: string; sessionId: string; news: BackgroundNews }> {
  const out: Array<{ runId: string; sessionId: string; news: BackgroundNews }> = [];
  for (const run of runs) {
    if (run.sessionId === openSessionId) continue;
    const before = previous.get(run.id);
    if (before ? before.status === run.status : (run.completedAt ?? run.updatedAt ?? "") <= since) continue;
    const news = NEWS[run.status];
    if (news) out.push({ runId: run.id, sessionId: run.sessionId, news });
  }
  return out;
}
