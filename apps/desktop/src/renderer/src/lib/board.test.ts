import { describe, expect, it } from "vitest";
import type { RunEvent } from "@capsule/shared";
import { latestStep, moveBoardFocus, promptPreview, readBoardScope } from "./board";

describe("moving around the board with arrow keys", () => {
  const columns = [["a1", "a2", "a3"], [], ["c1"], ["d1", "d2"]];

  it("starts on the first card when nothing has focus", () => {
    expect(moveBoardFocus(columns, undefined, "ArrowDown")).toBe("a1");
  });

  it("stays inside the column going up and down", () => {
    expect(moveBoardFocus(columns, "a2", "ArrowDown")).toBe("a3");
    expect(moveBoardFocus(columns, "a3", "ArrowDown")).toBe("a3");
    expect(moveBoardFocus(columns, "a1", "ArrowUp")).toBe("a1");
  });

  it("skips empty columns and keeps the nearest row going sideways", () => {
    expect(moveBoardFocus(columns, "a3", "ArrowRight")).toBe("c1");
    expect(moveBoardFocus(columns, "c1", "ArrowRight")).toBe("d1");
    expect(moveBoardFocus(columns, "d2", "ArrowLeft")).toBe("c1");
    expect(moveBoardFocus(columns, "a1", "ArrowLeft")).toBe("a1");
  });
});

describe("what a card says it is doing", () => {
  const event = (type: string, message: string, data: Record<string, unknown> = {}): RunEvent =>
    ({ id: `${type}-${message}`, runId: "r", timestamp: "2026-11-01T00:00:00Z", type, message, data });

  it("shows the newest step, not the first", () => {
    const step = latestStep([event("tool", "Read file", { streamKind: "tool", toolCallId: "1" }), event("agent.message", "All tests pass", { streamKind: "message" })], true);
    expect(step).toContain("All tests pass");
  });

  it("says nothing before the agent has done anything", () => {
    expect(latestStep([], false)).toBeUndefined();
  });

  it("previews a draft by its first written line", () => {
    expect(promptPreview("\n  Add tests\nthen more")).toBe("Add tests");
  });

  it("remembers the scope, defaulting to this project", () => {
    expect(readBoardScope(() => "all")).toBe("all");
    expect(readBoardScope(() => null)).toBe("project");
    expect(readBoardScope(() => { throw new Error("denied"); })).toBe("project");
  });
});
