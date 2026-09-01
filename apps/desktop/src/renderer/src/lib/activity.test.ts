import { describe, expect, it } from "vitest";
import type { RunEvent } from "@capsule/shared";
import { activityFromEvents } from "./activity.js";

const event = (streamKind: string, message: string, id: string): RunEvent => ({
  id,
  runId: "run_1",
  timestamp: "2026-08-26T00:00:00.000Z",
  type: streamKind,
  message,
  data: { streamKind },
});

describe("activityFromEvents", () => {
  it("derives phases from the agent's own stream kinds", () => {
    const phases = activityFromEvents(
      [
        event("thinking", "Considering the layout", "1"),
        event("tool", "read_file styles.css", "2"),
        event("message", "Here is the change", "3"),
      ],
      false,
    );
    expect(phases.map((p) => p.label)).toEqual(["Thinking", "Read 1 file", "Writing a reply"]);
  });

  it("folds consecutive frames of one kind into a single row", () => {
    const phases = activityFromEvents(
      [
        event("tool", "read_file a", "1"),
        event("tool", "read_file b", "2"),
        event("tool", "read_file c", "3"),
      ],
      false,
    );
    expect(phases).toHaveLength(1);
    // The row shows the most recent line for that phase.
    expect(phases[0]?.detail).toBe("read_file c");
  });

  it("marks only the final phase active while the run is in flight", () => {
    const phases = activityFromEvents(
      [event("thinking", "a", "1"), event("tool", "b", "2")],
      false,
    );
    expect(phases.map((p) => p.status)).toEqual(["complete", "active"]);
  });

  it("completes every phase once the run has finished", () => {
    const phases = activityFromEvents(
      [event("thinking", "a", "1"), event("tool", "b", "2")],
      true,
    );
    expect(phases.every((p) => p.status === "complete")).toBe(true);
  });

  it("surfaces an error phase as an error", () => {
    const phases = activityFromEvents([event("error", "Authentication required", "1")], true);
    expect(phases[0]?.status).toBe("error");
    expect(phases[0]?.detail).toBe("Authentication required");
  });

  it("ignores lifecycle noise and untagged events", () => {
    const untagged: RunEvent = {
      id: "x", runId: "run_1", timestamp: "t", type: "contract", message: "Contract created",
    };
    expect(activityFromEvents([event("lifecycle", "Run started", "1"), untagged], false)).toEqual([]);
  });

  it("hides or collapses thinking when asked", () => {
    const events = [event("thinking", "Considering the layout", "1"), event("tool", "read", "2")];
    expect(activityFromEvents(events, false, { reasoning: "hidden" }).map((p) => p.label)).toEqual([
      "Read 1 file",
    ]);
    expect(activityFromEvents(events, false, { reasoning: "collapsed" })[0]?.detail).toBeUndefined();
  });

  it("truncates a long detail to one line", () => {
    const phases = activityFromEvents(
      [event("thinking", `${"x".repeat(400)}\nsecond line`, "1")],
      false,
    );
    expect(phases[0]?.detail?.length).toBe(120);
  });
});

describe("activityFromEvents without stream kinds", () => {
  // The mock runtime and older Gateway builds tag only the event type.
  const typed = (type: string, message: string, id: string): RunEvent => ({
    id,
    runId: "run_1",
    timestamp: "2026-08-26T00:00:00.000Z",
    type,
    message,
  });

  it("recovers a kind from the event type", () => {
    const phases = activityFromEvents(
      [
        typed("tool.started", "read_file styles.css", "1"),
        typed("tool.completed", "done", "2"),
        typed("assistant", "Here is the change", "3"),
      ],
      false,
    );
    expect(phases.map((p) => p.label)).toEqual(["Read 1 file", "Writing a reply"]);
  });

  it("marks the group as failed when a tool call fails", () => {
    // A `.failed` frame closes the call the previous frame opened, exactly as
    // `.completed` does — but it must not be discarded the same way, or a tool
    // that failed is shown as "Read 1 file", complete, with nothing wrong.
    const phases = activityFromEvents(
      [
        typed("tool.started", "read_file missing.css", "1"),
        typed("tool.failed", "ENOENT: no such file", "2"),
      ],
      true,
    );
    expect(phases).toHaveLength(1);
    expect(phases[0]!.status).toBe("error");
  });

  it("keeps a failure visible once the run has moved on", () => {
    const phases = activityFromEvents(
      [
        typed("tool.started", "read_file missing.css", "1"),
        typed("tool.failed", "ENOENT", "2"),
        typed("tool.started", "read_file ok.css", "3"),
        typed("tool.completed", "done", "4"),
      ],
      true,
    );
    expect(phases.some((phase) => phase.status === "error")).toBe(true);
  });

  it("still ignores chrome events", () => {
    const phases = activityFromEvents(
      [typed("lifecycle", "Run started", "1"), typed("approval.requested", "x", "2"), typed("contract", "y", "3")],
      false,
    );
    expect(phases).toEqual([]);
  });
});

describe("work is summarised, not transcribed", () => {
  const ev = (streamKind: string, message: string, id: string): RunEvent => ({
    id, runId: "run_1", timestamp: "2026-08-26T00:00:00.000Z",
    type: streamKind, message, data: { streamKind },
  });

  it("collapses repeated reads into one counted line", () => {
    const phases = activityFromEvents(
      [ev("tool", "read_file a.ts", "1"), ev("tool", "read_file b.ts", "2"),
       ev("tool", "read_file c.ts", "3"), ev("tool", "read_file d.ts", "4")],
      true,
    );
    expect(phases).toHaveLength(1);
    expect(phases[0]?.label).toBe("Read 4 files");
    expect(phases[0]?.count).toBe(4);
  });

  it("uses the singular for one frame", () => {
    const phases = activityFromEvents([ev("tool", "read_file only.ts", "1")], true);
    expect(phases[0]?.label).toBe("Read 1 file");
  });

  it("counts commands and edits separately from reads", () => {
    const phases = activityFromEvents(
      [ev("tool", "read_file a.ts", "1"),
       ev("command", "ls src/", "2"), ev("command", "rg TODO", "3"),
       ev("patch", "edit styles.css", "4")],
      true,
    );
    expect(phases.map((p) => p.label)).toEqual(["Read 1 file", "Ran 2 commands", "Changed 1 file"]);
  });

  it("falls back to a generic tool count for unrecognised calls", () => {
    const phases = activityFromEvents(
      [ev("tool", "web_search capsule", "1"), ev("tool", "web_search acp", "2")],
      true,
    );
    expect(phases[0]?.label).toBe("Used 2 tools");
  });

  it("starts a new group when the action changes and back again", () => {
    const phases = activityFromEvents(
      [ev("tool", "read_file a", "1"), ev("command", "ls", "2"), ev("tool", "read_file b", "3")],
      true,
    );
    expect(phases.map((p) => p.label)).toEqual(["Read 1 file", "Ran 1 command", "Read 1 file"]);
  });

  it("leaves non-work phases labelled as before", () => {
    const phases = activityFromEvents(
      [ev("thinking", "considering", "1"), ev("message", "drafting", "2")],
      true,
    );
    expect(phases.map((p) => p.label)).toEqual(["Thinking", "Writing a reply"]);
  });
});

describe("full reasoning is kept, not truncated", () => {
  const ev = (streamKind: string, message: string, id: string): RunEvent => ({
    id, runId: "run_1", timestamp: "2026-08-26T00:00:00.000Z",
    type: streamKind, message, data: { streamKind },
  });

  it("joins every reasoning chunk in order", () => {
    const phases = activityFromEvents(
      [ev("thinking", "First I will read the file.", "1"),
       ev("thinking", "Then compare it to the siblings.", "2"),
       ev("thinking", "Then draft the change.", "3")],
      true,
    );
    expect(phases).toHaveLength(1);
    expect(phases[0]?.body).toBe(
      "First I will read the file.\nThen compare it to the siblings.\nThen draft the change.",
    );
  });

  it("keeps the whole thought even when the row detail is truncated", () => {
    const long = "y".repeat(400);
    const phases = activityFromEvents([ev("thinking", long, "1")], true);
    // The one-line row is capped…
    expect(phases[0]?.detail?.length).toBe(120);
    // …but nothing is lost.
    expect(phases[0]?.body).toHaveLength(400);
  });

  it("does not attach a body to non-reasoning phases", () => {
    const phases = activityFromEvents(
      [ev("tool", "read_file a.ts", "1"), ev("command", "ls", "2")],
      true,
    );
    expect(phases.every((p) => p.body === undefined)).toBe(true);
  });
});
