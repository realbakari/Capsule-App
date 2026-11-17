import { describe, expect, it } from "vitest";
import { statusLineParts } from "./status-line.js";

describe("statusLineParts", () => {
  it("names the agent and adds the Gateway only when the thread goes through it", () => {
    expect(statusLineParts(["harness"], { harness: "Codex", route: "direct" })[0]?.text).toBe("Codex");
    expect(statusLineParts(["harness"], { harness: "Codex", route: "gateway" })[0]?.text).toBe("Codex · Gateway");
  });

  it("says the latest turn in words and marks a failure", () => {
    expect(statusLineParts(["run"], { run: "approval_required" })[0]?.text).toBe("needs you");
    expect(statusLineParts(["run"], { run: "cancelled" })[0]?.text).toBe("stopped");
    expect(statusLineParts(["run"], { run: "failed" })[0]).toMatchObject({ text: "failed", tone: "critical" });
  });
});
