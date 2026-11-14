import { describe, expect, it, vi } from "vitest";
import type { AutomationConfig, CustomizationRunRecord, RunStatus } from "@capsule/shared";
import { AutomationScheduler, type AutomationEntry, type AutomationHost } from "./automations.js";

const EVERY_FIVE: AutomationConfig = { id: "beat", name: "Beat", schedule: "RRULE:FREQ=MINUTELY;INTERVAL=5", prompt: "Say the time." };

function harness(automations: AutomationConfig[] = [EVERY_FIVE]) {
  let now = new Date(2026, 10, 14, 9, 1).getTime();
  const store = new Map<string, string>();
  const runs = new Map<string, RunStatus>();
  const records: CustomizationRunRecord[] = [];
  let entries: AutomationEntry[] = automations.map((automation) => ({ key: `user:${automation.id}`, automation, source: { scope: "user", path: "/home/settings.json" } }));
  let next = 0;
  const started: Array<{ key: string; at: Date }> = [];
  const host: AutomationHost = {
    entries: () => entries,
    read: (key) => store.get(key),
    write: (key, value) => { store.set(key, value); },
    keys: (prefix) => [...store.keys()].filter((key) => key.startsWith(prefix)),
    start: async (entry, at, created) => {
      next += 1;
      created(`session-${next}`);
      started.push({ key: entry.key, at });
      runs.set(`run-${next}`, "running");
      return { sessionId: `session-${next}`, runId: `run-${next}` };
    },
    runStatus: (runId) => runs.get(runId),
    emit: vi.fn(),
    record: (run) => { records.push(run); },
  };
  const make = () => new AutomationScheduler(host, { now: () => now, tickMs: 60 * 60_000 });
  return {
    host, store, runs, records, started, make,
    advance: (minutes: number) => { now += minutes * 60_000; },
    set entries(value: AutomationEntry[]) { entries = value; },
    get entries() { return entries; },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("automation scheduler", () => {
  it("tells Run now about the thread before its agent has answered", async () => {
    const h = harness();
    let answer: () => void = () => undefined;
    h.host.start = (_entry, _at, created) => {
      created("session-slow");
      return new Promise((resolve) => { answer = () => resolve({ sessionId: "session-slow", runId: "run-slow" }); });
    };
    const scheduler = h.make();
    const seen: string[] = [];
    const done = scheduler.runNow("user:beat", (sessionId) => seen.push(sessionId));
    await flush();
    expect(seen).toEqual(["session-slow"]);
    expect(scheduler.views()[0]!.lastRun).toMatchObject({ status: "running" });
    answer();
    await done;
  });

  it("anchors a new automation when first seen and runs it at its next occurrence, once", async () => {
    const h = harness();
    const scheduler = h.make();
    scheduler.start();
    expect(h.started).toHaveLength(0);
    const view = scheduler.views()[0]!;
    expect(view.scheduleText).toBe("Every 5 minutes");
    expect(new Date(view.nextRunAt!).getMinutes()).toBe(6);
    h.advance(5);
    scheduler.tick();
    await flush();
    expect(h.started).toHaveLength(1);
    expect(scheduler.views()[0]!.lastRun).toMatchObject({ status: "running", trigger: "schedule", sessionId: "session-1", runId: "run-1" });
    scheduler.tick();
    await flush();
    expect(h.started).toHaveLength(1);
    scheduler.stop();
  });

  it("skips an occurrence while the previous run is still going, and says so", async () => {
    const h = harness();
    const scheduler = h.make();
    scheduler.start();
    h.advance(5);
    scheduler.tick();
    await flush();
    h.advance(5);
    scheduler.tick();
    await flush();
    expect(h.started).toHaveLength(1);
    const view = scheduler.views()[0]!;
    expect(view.running).toBe(true);
    expect(view.skippedAt).toBeDefined();
    expect(h.records.at(-1)).toMatchObject({ kind: "automation", label: "Beat", outcome: "skipped: the previous run was still going" });
    h.runs.set("run-1", "completed");
    scheduler.runEnded("run-1", "completed");
    expect(scheduler.views()[0]).toMatchObject({ running: false, lastRun: { status: "completed" } });
    h.advance(5);
    scheduler.tick();
    await flush();
    expect(h.started).toHaveLength(2);
    scheduler.stop();
  });

  it("counts occurrences that passed while Capsule was closed as missed, runs none of them, and lets Run now answer them", async () => {
    const h = harness();
    const first = h.make();
    first.start();
    first.stop();
    h.advance(63);
    const second = h.make();
    second.start();
    await flush();
    expect(h.started).toHaveLength(0);
    const view = second.views()[0]!;
    expect(view.missed?.count).toBe(12);
    await second.runNow(view.key);
    expect(h.started).toHaveLength(1);
    expect(second.views()[0]!.missed).toBeUndefined();
    expect(second.views()[0]!.lastRun?.trigger).toBe("manual");
    await expect(second.runNow(view.key)).rejects.toThrow("still running");
    second.stop();
  });

  it("lets missed occurrences go when dismissed", () => {
    const h = harness();
    const first = h.make();
    first.start();
    first.stop();
    h.advance(33);
    const second = h.make();
    second.start();
    expect(second.views()[0]!.missed?.count).toBe(6);
    second.dismissMissed("user:beat");
    expect(second.views()[0]!.missed).toBeUndefined();
    second.stop();
  });

  it("runs nothing while paused, and does not count the pause as missed when resumed", async () => {
    const h = harness([{ ...EVERY_FIVE, enabled: false }]);
    const scheduler = h.make();
    scheduler.start();
    h.advance(30);
    scheduler.tick();
    await flush();
    expect(h.started).toHaveLength(0);
    expect(scheduler.views()[0]).toMatchObject({ enabled: false });
    expect(scheduler.views()[0]!.nextRunAt).toBeUndefined();
    h.entries = [{ ...h.entries[0]!, automation: EVERY_FIVE }];
    h.advance(1);
    scheduler.tick();
    expect(scheduler.views()[0]!.missed).toBeUndefined();
    scheduler.stop();
  });

  it("does not count the time an automation was out of the files as missed when it comes back", () => {
    const h = harness();
    const scheduler = h.make();
    scheduler.start();
    const kept = h.entries;
    h.entries = [];
    h.advance(60);
    scheduler.tick();
    h.entries = kept;
    h.advance(1);
    scheduler.tick();
    expect(scheduler.views()[0]!.missed).toBeUndefined();
    scheduler.stop();
  });

  it("names a broken automation's problem and never runs it", async () => {
    const h = harness([{ id: "bad", name: "Bad", schedule: "RRULE:FREQ=MINUTELY;INTERVAL=1", prompt: "x" }, { id: "both", name: "Both", schedule: "RRULE:FREQ=DAILY", prompt: "x", command: "y" }]);
    const scheduler = h.make();
    scheduler.start();
    h.advance(24 * 60);
    scheduler.tick();
    await flush();
    expect(h.started).toHaveLength(0);
    const [bad, both] = scheduler.views();
    expect(bad!.problem).toContain("at most every 5 minutes");
    expect(both!.problem).toBe("Give exactly one of prompt or command.");
    await expect(scheduler.runNow("user:bad")).rejects.toThrow("cannot run");
    scheduler.stop();
  });

  it("marks a run left going by a closed app as failed when the run is gone", () => {
    const h = harness();
    h.store.set("automation:user:beat", JSON.stringify({ firstSeenAt: new Date(2026, 10, 14, 9).toISOString(), checkedAt: new Date(2026, 10, 14, 9, 1).toISOString(), lastRun: { at: new Date(2026, 10, 14, 9).toISOString(), trigger: "schedule", status: "running" } }));
    const scheduler = h.make();
    scheduler.start();
    expect(scheduler.views()[0]!.lastRun).toMatchObject({ status: "failed", detail: "Capsule closed before the run started." });
    expect(scheduler.views()[0]!.running).toBe(false);
    scheduler.stop();
  });
});
