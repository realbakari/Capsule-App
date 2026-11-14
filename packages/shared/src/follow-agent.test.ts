import { describe, expect, it } from "vitest";
import { agentFileFromEvent, latestAgentFile } from "./follow-agent.js";
import type { RunEvent } from "./types.js";

const event = (id: string, data: Record<string, unknown>, type = "tool", runId = "run"): RunEvent =>
  ({ id, runId, type, message: "", timestamp: "2026-11-14T00:00:00.000Z", data });

describe("agentFileFromEvent", () => {
  it("takes the reported location of a read or an edit", () => {
    expect(agentFileFromEvent(event("a", { kind: "read", locations: [{ path: "/repo/README.md" }] }))).toBe("/repo/README.md");
    expect(agentFileFromEvent(event("b", { kind: "edit", locations: [{ path: "a.ts" }, { path: "b.ts" }] }))).toBe("b.ts");
  });

  it("reads a nested Gateway payload and a path named only in the input", () => {
    expect(agentFileFromEvent(event("a", { data: { kind: "edit", rawInput: { file_path: "src/app.ts" } } }))).toBe("src/app.ts");
    expect(agentFileFromEvent(event("b", { title: "Write", rawInput: { path: "notes.md" } }))).toBe("notes.md");
  });

  it("ignores searches, commands, failures and events that are not tools", () => {
    expect(agentFileFromEvent(event("a", { kind: "search", locations: [{ path: "a.ts" }] }))).toBeUndefined();
    expect(agentFileFromEvent(event("b", { kind: "execute", rawInput: { command: "ls", path: "x" } }))).toBeUndefined();
    expect(agentFileFromEvent(event("c", { kind: "read", status: "failed", locations: [{ path: "a.ts" }] }))).toBeUndefined();
    expect(agentFileFromEvent(event("d", { kind: "read", locations: [{ path: "a.ts" }] }, "message"))).toBeUndefined();
    expect(agentFileFromEvent(event("e", { kind: "read" }))).toBeUndefined();
  });
});

describe("latestAgentFile", () => {
  it("returns the newest followed file in this run only", () => {
    const events = [
      event("1", { kind: "read", locations: [{ path: "a.ts" }] }),
      event("2", { kind: "edit", locations: [{ path: "b.ts" }] }),
      event("3", { kind: "execute", rawInput: { command: "npm test" } }),
      event("4", { kind: "read", locations: [{ path: "other.ts" }] }, "tool", "other-run"),
    ];
    expect(latestAgentFile(events, "run")).toEqual({ path: "b.ts", eventId: "2" });
    expect(latestAgentFile(events, "missing")).toBeUndefined();
  });
});
