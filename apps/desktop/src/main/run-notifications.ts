import type { Run } from "@capsule/shared";

/** Checkpoint and verification metadata updates are not new completions. */
export class RunNotifications {
  private readonly settled = new Set<string>();

  firstSettlement(run: Pick<Run, "id" | "status">): boolean {
    if (!["completed", "failed", "cancelled"].includes(run.status) || this.settled.has(run.id)) return false;
    this.settled.add(run.id);
    // This is a live-notification guard, not another copy of run history.
    if (this.settled.size > 4096) this.settled.delete(this.settled.values().next().value!);
    return true;
  }
}
