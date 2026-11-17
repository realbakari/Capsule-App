import { describe, expect, it } from "vitest";
import type { HarnessStatus } from "@capsule/shared";
import { checklistVisible, firstRunAgent, setupChecklist, shouldOpenFirstRun } from "./setup-progress";

const harness = (readiness: HarnessStatus["readiness"], id = "agent", featured = false) => ({ id, name: id, readiness, featured } as HarnessStatus);

describe("shouldOpenFirstRun", () => {
  it("opens for a new profile with no projects", () => {
    expect(shouldOpenFirstRun({ desktop: true, settings: { firstRunDone: false }, projectCount: 0 })).toBe(true);
  });

  it("never opens for a profile that already has projects", () => {
    expect(shouldOpenFirstRun({ desktop: true, settings: { firstRunDone: false }, projectCount: 2 })).toBe(false);
  });

  it("stays closed once finished or put off, on a paired device, and before settings load", () => {
    expect(shouldOpenFirstRun({ desktop: true, settings: { firstRunDone: true }, projectCount: 0 })).toBe(false);
    expect(shouldOpenFirstRun({ desktop: false, settings: { firstRunDone: false }, projectCount: 0 })).toBe(false);
    expect(shouldOpenFirstRun({ desktop: true, settings: undefined, projectCount: 0 })).toBe(false);
  });
});

describe("setup checklist", () => {
  it("counts a ready agent and a folder", () => {
    const items = setupChecklist({ harnesses: [harness("missing_cli"), harness("dedicated")], projectCount: 0 });
    expect(items.map((item) => [item.id, item.done])).toEqual([["agent", true], ["folder", false]]);
  });

  it("shows while setup is pending and incomplete, on the desktop only", () => {
    const items = setupChecklist({ harnesses: [harness("needs_login")], projectCount: 1 });
    const done = setupChecklist({ harnesses: [harness("ready")], projectCount: 1 });
    expect(checklistVisible({ desktop: true, marks: { pending: true }, items })).toBe(true);
    expect(checklistVisible({ desktop: true, marks: { pending: false }, items })).toBe(false);
    expect(checklistVisible({ desktop: false, marks: { pending: true }, items })).toBe(false);
    expect(checklistVisible({ desktop: true, marks: { pending: true }, items: done })).toBe(false);
  });
});

describe("firstRunAgent", () => {
  const claude = harness("missing_cli", "claude", true);
  const codex = harness("ready", "codex", true);
  const opencode = harness("ready", "opencode");

  it("keeps the picked agent when it is ready", () => {
    expect(firstRunAgent([claude, codex, opencode], "opencode")?.id).toBe("opencode");
  });

  it("moves off a picked agent that is not installed, preferring a featured one", () => {
    expect(firstRunAgent([claude, opencode, codex], "claude")?.id).toBe("codex");
    expect(firstRunAgent([claude, opencode], "claude")?.id).toBe("opencode");
    expect(firstRunAgent([claude, codex], undefined)?.id).toBe("codex");
  });

  it("leaves a Gateway or mock agent alone, and has nothing to offer when no agent is ready", () => {
    expect(firstRunAgent([claude, codex], "main")).toBeUndefined();
    expect(firstRunAgent([claude], "claude")).toBeUndefined();
  });
});
