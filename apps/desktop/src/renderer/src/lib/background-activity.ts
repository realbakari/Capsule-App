import type { Run } from "@capsule/shared";

type RunSnapshot = Pick<Run, "id" | "sessionId" | "status"> & Partial<Pick<Run, "error" | "updatedAt" | "completedAt">>;

const SETTLED = new Set<Run["status"]>(["completed", "failed", "blocked"]);

/**
 * Runs that settled between two snapshots of the latest runs.
 *
 * A change counts, and so does a run first seen already settled if it
 * settled after `since` (a fast turn can start and finish between two
 * updates). Anything older is history being loaded, not news. Whether the
 * thread is on screen is the notice policy's call, not this one's.
 */
export function settledRuns<T extends RunSnapshot>(
  previous: ReadonlyMap<string, Pick<Run, "status">>,
  runs: readonly T[],
  since: string,
): T[] {
  return runs.filter((run) => {
    if (!SETTLED.has(run.status)) return false;
    const before = previous.get(run.id);
    return before ? before.status !== run.status : (run.completedAt ?? run.updatedAt ?? "") > since;
  });
}
