import { describe, expect, it } from "vitest";
import { runActivityLabel } from "./run-activity.js";
import type { Run } from "./types.js";

describe("truthful activity", () => {
  it("separates stopping from acknowledged cancellation and failure", () => {
    expect(runActivityLabel({ status: "running" } as Run, true)).toBe("Stopping");
    expect(runActivityLabel({ status: "failed" } as Run, true)).toBe("Failed");
    expect(runActivityLabel({ status: "cancelled" } as Run)).toBe("Stopped");
    expect(runActivityLabel({ status: "completed" } as Run)).toBe("Completed · not verified");
  });
  it("requires successful evidence for this run before saying verified", () => {
    const run = { id: "r", status: "completed", verification: { passed: true, status: "passed" } } as Run;
    expect(runActivityLabel(run)).not.toBe("Verified");
    run.verification!.evidence = { runId: "other", exitCode: 0 } as NonNullable<Run["verification"]>["evidence"];
    expect(runActivityLabel(run)).not.toBe("Verified");
    run.verification!.evidence!.runId = "r";
    expect(runActivityLabel(run)).toBe("Verified");
    run.verification!.status = "stale";
    expect(runActivityLabel(run)).toBe("Checks stale");
  });
});
