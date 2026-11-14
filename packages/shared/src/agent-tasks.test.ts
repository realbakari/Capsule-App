import { describe, expect, it } from "vitest";
import { agentTaskStart, agentTaskStartRefusal, projectAllowsAgentStarts, readAgentTaskRequest } from "./agent-tasks.js";
import { normalizeCapsuleSettings } from "./runtime.js";

describe("agent task start rule", () => {
  it("keeps every agent-created card a draft unless the project allows starts", () => {
    expect(agentTaskStart(false, [])).toEqual({ start: false, autoStart: false });
    expect(agentTaskStart(false, ["a"])).toEqual({ start: false, autoStart: false });
    expect(agentTaskStartRefusal(false)).toMatch(/drafts/);
  });

  it("starts now, or after its dependencies, when the project allows it", () => {
    expect(agentTaskStart(true, [])).toEqual({ start: true, autoStart: true });
    expect(agentTaskStart(true, ["a"])).toEqual({ start: false, autoStart: true });
    expect(agentTaskStartRefusal(true)).toBeUndefined();
  });

  it("is off by default and per project", () => {
    const settings = normalizeCapsuleSettings({});
    expect(projectAllowsAgentStarts(settings.agentTaskAutoStart, "p1")).toBe(false);
    const allowed = normalizeCapsuleSettings({ agentTaskAutoStart: ["p1", "p1", 3 as unknown as string] });
    expect(allowed.agentTaskAutoStart).toEqual(["p1"]);
    expect(projectAllowsAgentStarts(allowed.agentTaskAutoStart, "p2")).toBe(false);
  });
});

describe("readAgentTaskRequest", () => {
  it("accepts a full request and trims it", () => {
    expect(readAgentTaskRequest({ title: " Docs ", prompt: "Write docs", agent: "claude", workspace: "worktree", depends_on: ["a", "a"] }))
      .toEqual({ title: "Docs", prompt: "Write docs", agentId: "claude", workspaceMode: "worktree", dependsOn: ["a"] });
  });

  it("names what is wrong", () => {
    expect(readAgentTaskRequest({ title: "", prompt: "p" })).toEqual({ error: expect.stringContaining("title") });
    expect(readAgentTaskRequest({ title: "t", prompt: "p".repeat(20_001) })).toEqual({ error: expect.stringContaining("prompt") });
    expect(readAgentTaskRequest({ title: "t", prompt: "p", depends_on: "a" })).toEqual({ error: expect.stringContaining("depends_on") });
  });
});
