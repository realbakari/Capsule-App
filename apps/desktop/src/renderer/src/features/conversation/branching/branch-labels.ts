import type { ForkBranch, RedoPoint, RunStatus } from "@capsule/shared";
import { compactRelativeTime } from "../../../lib/sidebar";

const STATUS: Record<RunStatus, string> = {
  queued: "queued",
  running: "working",
  waiting: "working",
  approval_required: "needs approval",
  completed: "done",
  failed: "failed",
  cancelled: "stopped",
  blocked: "blocked",
};

/** One line that tells branches apart: where it came from, where it runs, how far it got. */
export function branchMeta(branch: ForkBranch, now = Date.now()): string {
  const when = branch.forkedAt ? compactRelativeTime(branch.forkedAt, now) : "";
  const origin = branch.original ? "Original" : when === "now" ? "Forked just now" : `Forked ${when} ago`;
  const progress = branch.turnsSince === 0
    ? "no turns since"
    : `${branch.turnsSince} turn${branch.turnsSince === 1 ? "" : "s"} since${branch.latestStatus ? `, last ${STATUS[branch.latestStatus]}` : ""}`;
  return [origin, branch.worktree ? "own worktree" : undefined, progress, branch.archived ? "archived" : undefined].filter(Boolean).join(" · ");
}

export function redoSummary(point: RedoPoint, turnNumber: number | undefined): string {
  const turn = turnNumber ? `turn ${turnNumber}` : "the start";
  const hidden = `${point.hiddenMessages} message${point.hiddenMessages === 1 ? "" : "s"}`;
  if (point.edit) return `Edited from ${turn === "the start" ? "the first prompt" : `after ${turn}`}: ${hidden} set aside${point.filesSaved ? " and files restored" : ""}.`;
  if (point.scope === "files") return `Restored the files to ${turn}.`;
  if (point.scope === "conversation") return `Restored the conversation to ${turn}: ${hidden} set aside.`;
  return `Restored the files and conversation to ${turn}: ${hidden} set aside.`;
}
