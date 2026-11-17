import { describe, expect, it } from "vitest";
import type { AttentionSummary } from "@capsule/shared";
import { trayMenuTemplate, type TrayMenuInput, type TrayMenuItem } from "./tray-menu";

const quiet: AttentionSummary = { items: [], counts: { "needs-input": 0, blocked: 0, ready: 0, running: 0 } };

function input(overrides: Partial<TrayMenuInput> = {}): TrayMenuInput {
  return {
    summary: quiet,
    sessions: [
      { id: "a", title: "Fix login", projectId: "p", state: "active", createdAt: "2026-11-01T00:00:00Z" },
      { id: "b", title: "Write docs", projectId: "p", state: "active", createdAt: "2026-11-02T00:00:00Z" },
      { id: "c", title: "Old idea", projectId: "p", state: "archived", createdAt: "2026-11-03T00:00:00Z" },
    ],
    latestRuns: [{ sessionId: "a", createdAt: "2026-11-05T00:00:00Z", completedAt: "2026-11-05T00:10:00Z" }],
    projectNames: new Map([["p", "Example"]]),
    companionOpen: false,
    canOpenWindow: true,
    ...overrides,
  };
}

const labels = (items: TrayMenuItem[]) => items.map((item) => item.type === "separator" ? "—" : item.label);

describe("trayMenuTemplate", () => {
  it("says nothing needs you, then offers work and the window, with no About or Approvals rows", () => {
    const menu = trayMenuTemplate(input());
    expect(labels(menu)).toEqual(["Nothing needs you", "—", "New Conversation", "Recent", "Show Capsule", "—", "Desktop Companion", "Settings…", "—", "Quit Capsule"]);
    expect(menu[0]!.enabled).toBe(false);
  });

  it("lists recent active threads by activity, newest first, with their project", () => {
    const recent = trayMenuTemplate(input()).find((item) => item.label === "Recent")!.submenu!;
    expect(recent.map((item) => item.label)).toEqual(["Fix login", "Write docs"]);
    expect(recent[0]).toMatchObject({ sublabel: "Example", action: { kind: "open-session", sessionId: "a" } });
  });

  it("leads with what is waiting and keeps those threads out of Recent", () => {
    const summary: AttentionSummary = {
      items: [{ sessionId: "b", title: "Write docs", state: "needs-input", at: "2026-11-06T00:00:00Z" }],
      counts: { "needs-input": 1, blocked: 0, ready: 0, running: 0 },
    };
    const menu = trayMenuTemplate(input({ summary }));
    expect(menu[0]!.label).toBe("1 needs input");
    expect(menu[1]).toMatchObject({ label: "●  Write docs", sublabel: "Example", action: { kind: "open-session", sessionId: "b" } });
    expect(menu.find((item) => item.label === "Recent")!.submenu!.map((item) => item.label)).toEqual(["Fix login"]);
  });

  it("caps the waiting list and points to the rest", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ sessionId: `s${index}`, title: `T${index}`, state: "running" as const, at: "2026-11-06T00:00:00Z" }));
    const menu = trayMenuTemplate(input({ summary: { items, counts: { "needs-input": 0, blocked: 0, ready: 0, running: 10 } } }));
    expect(menu.filter((item) => item.label?.startsWith("○")).length).toBe(8);
    expect(menu.find((item) => item.label === "2 more in Capsule")?.action).toEqual({ kind: "show" });
  });

  it("shows the companion as a checkbox whose click flips it", () => {
    const off = trayMenuTemplate(input()).find((item) => item.label === "Desktop Companion")!;
    expect(off).toMatchObject({ type: "checkbox", checked: false, action: { kind: "companion", open: true } });
    const on = trayMenuTemplate(input({ companionOpen: true })).find((item) => item.label === "Desktop Companion")!;
    expect(on).toMatchObject({ checked: true, action: { kind: "companion", open: false } });
  });

  it("disables window rows while the window cannot open, but Quit always works", () => {
    const menu = trayMenuTemplate(input({ canOpenWindow: false }));
    expect(menu.find((item) => item.label === "Show Capsule")!.enabled).toBe(false);
    expect(menu.find((item) => item.label === "Quit Capsule")!.enabled).not.toBe(false);
  });
});
