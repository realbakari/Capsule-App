import { describe, expect, it } from "vitest";
import type { HarnessStatus } from "@capsule/shared";
import { checklistVisible, setupChecklist, shouldOpenFirstRun } from "./setup-progress";

const harness = (readiness: HarnessStatus["readiness"]) => ({ readiness } as HarnessStatus);

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
  it("counts a ready agent, a folder and a notification choice", () => {
    const items = setupChecklist({ harnesses: [harness("missing_cli"), harness("dedicated")], projectCount: 0, notificationsChosen: false });
    expect(items.map((item) => [item.id, item.done])).toEqual([["agent", true], ["folder", false], ["notifications", false]]);
  });

  it("shows while setup is pending and incomplete, on the desktop only", () => {
    const items = setupChecklist({ harnesses: [harness("needs_login")], projectCount: 1, notificationsChosen: false });
    const done = setupChecklist({ harnesses: [harness("ready")], projectCount: 1, notificationsChosen: true });
    expect(checklistVisible({ desktop: true, marks: { pending: true, notificationsChosen: false }, items })).toBe(true);
    expect(checklistVisible({ desktop: true, marks: { pending: false, notificationsChosen: false }, items })).toBe(false);
    expect(checklistVisible({ desktop: false, marks: { pending: true, notificationsChosen: false }, items })).toBe(false);
    expect(checklistVisible({ desktop: true, marks: { pending: true, notificationsChosen: true }, items: done })).toBe(false);
  });
});
