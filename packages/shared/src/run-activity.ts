import type { Run } from "./types.js";

/** Completion is not evidence that a check passed. */
export function runActivityLabel(run?: Run, stopping = false): string {
  if (!run) return "Activity";
  if (run.status === "failed") return "Failed";
  if (run.status === "cancelled") return "Stopped";
  if (run.status === "blocked") return "Blocked";
  if (run.status === "completed") {
    const result = run.verification;
    if (result?.inProgress) return "Checking";
    if (result?.status === "passed" && result.passed && result.evidence?.runId === run.id && result.evidence.exitCode === 0) return "Verified";
    if (result?.status === "failed") return "Check failed";
    if (result?.status === "stale") return "Checks stale";
    return "Completed · not verified";
  }
  if (stopping) return "Stopping";
  if (run.status === "approval_required") return "Needs approval";
  if (run.status === "queued") return "Queued";
  if (run.status === "waiting") return "Waiting";
  return "Running";
}
