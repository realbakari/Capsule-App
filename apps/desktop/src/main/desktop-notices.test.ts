import { describe, expect, it } from "vitest";
import { DesktopNotices } from "./desktop-notices";

function harness() {
  const shown: Array<{ title: string; body: string; silent: boolean; sessionId?: string; closed: boolean }> = [];
  const timers: Array<() => void> = [];
  let clock = "2026-11-17T10:00:00.000Z";
  const notices = new DesktopNotices({
    show: (notice) => {
      const entry = { ...notice, closed: false };
      shown.push(entry);
      return { close: () => { entry.closed = true; } };
    },
    schedule: (run) => { timers.push(run); },
  }, () => clock);
  const flush = () => { for (const run of timers.splice(0)) run(); };
  return { notices, shown, flush, at: (iso: string) => { clock = iso; } };
}

describe("desktop notifications", () => {
  it("sends a burst as one notification", () => {
    const { notices, shown, flush } = harness();
    notices.push({ kind: "finished", sessionId: "a", threadTitle: "Docs" }, false);
    notices.push({ kind: "question", sessionId: "b", threadTitle: "Login", detail: "Which branch?" }, true);
    expect(shown).toEqual([]);
    flush();
    expect(shown).toEqual([{ title: "1 conversation needs you", body: "“Login” has a question · “Docs” finished", sessionId: "b", silent: false, closed: false }]);
  });

  it("is silent only when every notice in the burst asked for silence", () => {
    const { notices, shown, flush } = harness();
    notices.push({ kind: "finished", sessionId: "a", threadTitle: "Docs" }, false);
    flush();
    expect(shown[0]?.silent).toBe(true);
  });

  it("replaces a thread's older notification with its newer one", () => {
    const { notices, shown, flush } = harness();
    notices.push({ kind: "finished", sessionId: "a", threadTitle: "Docs" }, true);
    flush();
    notices.push({ kind: "failed", sessionId: "a", threadTitle: "Docs", detail: "Tests failed" }, true);
    flush();
    expect(shown.map((entry) => [entry.body, entry.closed])).toEqual([["Finished", true], ["Failed: Tests failed", false]]);
  });

  it("clears a notification once every thread it names has been opened since", () => {
    const { notices, shown, flush, at } = harness();
    notices.push({ kind: "finished", sessionId: "a", threadTitle: "Docs" }, true);
    notices.push({ kind: "finished", sessionId: "b", threadTitle: "Login" }, true);
    flush();
    const viewed = new Map<string, string>([["a", "2026-11-17T09:00:00.000Z"]]);
    notices.viewed((id) => viewed.get(id));
    expect(shown[0]?.closed).toBe(false);
    at("2026-11-17T10:05:00.000Z");
    viewed.set("a", "2026-11-17T10:01:00.000Z");
    notices.viewed((id) => viewed.get(id));
    expect(shown[0]?.closed).toBe(false);
    viewed.set("b", "2026-11-17T10:02:00.000Z");
    notices.viewed((id) => viewed.get(id));
    expect(shown[0]?.closed).toBe(true);
  });
});
