import { describe, expect, it } from "vitest";
import type { FollowUpPrompt, Run } from "@capsule/shared";
import { AUTO_RESUME_LIMIT, FollowUpService, type FollowUpHost } from "./follow-up-service.js";

function harness(options: { autoResume?: boolean } = {}) {
  const store = new Map<string, string>();
  const sent: Array<{ sessionId: string; prompt: FollowUpPrompt }> = [];
  const busy = new Set<string>();
  const runs: Run[] = [];
  let failWith: string | undefined;
  let now = Date.parse("2026-11-13T10:00:00Z");
  const host: FollowUpHost = {
    read: (key) => store.get(key),
    write: (key, value) => { store.set(key, value); },
    remove: (key) => { store.delete(key); },
    keys: (prefix) => [...store.keys()].filter((key) => key.startsWith(prefix)),
    sessionExists: (sessionId) => sessionId !== "gone",
    isBusy: (sessionId) => busy.has(sessionId),
    send: async (sessionId, prompt) => {
      if (failWith) throw new Error(failWith);
      sent.push({ sessionId, prompt });
    },
    blocker: () => undefined,
    emit: () => {},
    autoResume: () => options.autoResume ?? false,
    recentRuns: (sessionId) => runs.filter((run) => run.sessionId === sessionId).reverse(),
    attachmentsFor: () => [{ name: "shot.png", path: "/tmp/shot.png", size: 1 }],
    log: () => {},
  };
  const service = new FollowUpService(host, { settleMs: 60_000, retryMs: 60_000, tickMs: 60_000, now: () => now });
  return {
    service, sent, busy, runs, store,
    fail: (message?: string) => { failWith = message; },
    advance: (ms: number) => { now += ms; },
    tick: () => (service as unknown as { tick: () => void }).tick(),
  };
}

const failedRun = (id: string, error: string): Run => ({
  id, sessionId: "s1", projectId: "p", agentId: "a", status: "failed", prompt: "Finish the report", error,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
} as unknown as Run);

describe("follow-ups kept by the engine", () => {
  it("sends a queued prompt for a conversation nobody is looking at once it is free", async () => {
    const { service, sent, busy } = harness();
    busy.add("s1");
    service.apply("s1", { type: "add", prompt: { content: "Then add tests", attachments: [] } });
    await service.drain("s1");
    expect(sent).toEqual([]);
    busy.delete("s1");
    await service.drain("s1");
    expect(sent.map((item) => item.prompt.content)).toEqual(["Then add tests"]);
    expect(service.get("s1").queue).toEqual([]);
  });

  it("keeps a prompt that could not be sent first in line, with the reason, and sends it later", async () => {
    const { service, sent, fail } = harness();
    service.apply("s1", { type: "add", prompt: { content: "one", attachments: [] } });
    service.apply("s1", { type: "add", prompt: { content: "two", attachments: [] } });
    fail("OpenClaw Gateway is not connected");
    await service.drain("s1");
    expect(service.get("s1").queue.map((item) => item.content)).toEqual(["one", "two"]);
    expect(service.get("s1").blocked).toMatch(/not connected/);
    fail(undefined);
    await service.drain("s1");
    expect(sent.map((item) => item.prompt.content)).toEqual(["one"]);
    expect(service.get("s1").blocked).toBeUndefined();
  });

  it("moves a due resume into the queue and sends it, attachments included", async () => {
    const { service, sent, advance, tick } = harness();
    service.apply("s1", { type: "schedule", resume: { runId: "r1", prompt: "Pick up where you stopped", attachments: [{ name: "a.txt", path: "/tmp/a.txt", size: 1 }], at: Date.parse("2026-11-13T10:05:00Z") } });
    tick();
    await Promise.resolve();
    expect(sent).toEqual([]);
    advance(6 * 60_000);
    tick();
    await new Promise((resolve) => setImmediate(resolve));
    expect(sent[0]?.prompt).toMatchObject({ content: "Pick up where you stopped", attachments: [{ name: "a.txt" }] });
    expect(service.get("s1").resume).toBeUndefined();
  });

  it("schedules a limit stop at least a minute out, and stops after several in a row", () => {
    const { service, runs } = harness({ autoResume: true });
    const first = failedRun("r1", "Usage limit reached. Try again in 5 seconds.");
    runs.push(first);
    service.runEnded(first);
    const resume = service.get("s1").resume!;
    expect(resume.runId).toBe("r1");
    expect(resume.at - Date.parse("2026-11-13T10:00:00Z")).toBeGreaterThanOrEqual(60_000);
    expect(resume.attachments).toEqual([{ name: "shot.png", path: "/tmp/shot.png", size: 1 }]);

    service.apply("s1", { type: "cancel-resume" });
    for (let index = 2; index <= AUTO_RESUME_LIMIT + 1; index += 1) runs.push(failedRun(`r${index}`, "Usage limit reached. Try again in 5 seconds."));
    service.runEnded(runs.at(-1)!);
    expect(service.get("s1").resume).toBeUndefined();
    expect(service.get("s1").blocked).toMatch(/Auto-resume stopped/);
  });

  it("holds the queue after a turn that was stopped or failed, until the person lets it go", async () => {
    for (const [run, reason] of [
      [{ ...failedRun("r1", "x"), status: "cancelled" } as Run, "Paused after the turn was stopped."],
      [failedRun("r2", "The agent crashed."), "Paused after the turn failed."],
      [failedRun("r3", "Usage limit reached. Try again in 30 minutes."), "Paused after the turn hit a usage limit."],
    ] as const) {
      const { service, sent } = harness();
      service.apply("s1", { type: "add", prompt: { content: "then add tests", attachments: [] } });
      service.runEnded(run);
      expect(service.get("s1").held).toBe(reason);
      await service.drain("s1");
      expect(sent).toEqual([]);
      service.apply("s1", { type: "release" });
      expect(service.get("s1").held).toBeUndefined();
      await service.drain("s1");
      expect(sent.map((item) => item.prompt.content)).toEqual(["then add tests"]);
      service.stop();
    }
  });

  it("does not hold an empty queue, and a completed turn leaves a held queue held", () => {
    const { service } = harness();
    service.runEnded(failedRun("r1", "boom"));
    expect(service.get("s1").held).toBeUndefined();
    service.apply("s1", { type: "add", prompt: { content: "next", attachments: [] } });
    service.runEnded(failedRun("r2", "boom"));
    service.runEnded({ ...failedRun("r3", ""), status: "completed" } as Run);
    expect(service.get("s1").held).toBe("Paused after the turn failed.");
    service.stop();
  });

  it("lets the person's own send release the hold, and puts it back when that send never starts", () => {
    const { service } = harness();
    service.apply("s1", { type: "add", prompt: { content: "next", attachments: [] } });
    service.runEnded(failedRun("r1", "boom"));
    const lifted = service.releaseForPerson("s1");
    expect(lifted).toBe("Paused after the turn failed.");
    expect(service.get("s1").held).toBeUndefined();
    service.hold("s1", lifted!);
    expect(service.get("s1").held).toBe("Paused after the turn failed.");
    service.stop();
  });

  it("sends a chosen prompt first when released with it", async () => {
    const { service, sent } = harness();
    service.apply("s1", { type: "add", prompt: { content: "one", attachments: [] } });
    const two = service.apply("s1", { type: "add", prompt: { content: "two", attachments: [] } }).queue[1]!;
    service.runEnded(failedRun("r1", "boom"));
    service.apply("s1", { type: "release", id: two.id });
    await service.drain("s1");
    expect(sent.map((item) => item.prompt.content)).toEqual(["two"]);
    expect(service.get("s1").queue.map((item) => item.content)).toEqual(["one"]);
    service.stop();
  });

  it("sends a due resume ahead of a held queue, and keeps the rest held", async () => {
    const { service, sent, advance, tick } = harness();
    service.apply("s1", { type: "add", prompt: { content: "then add tests", attachments: [] } });
    service.runEnded(failedRun("r1", "Usage limit reached. Try again in 5 minutes."));
    service.apply("s1", { type: "schedule", resume: { runId: "r1", prompt: "Finish the report", attachments: [], at: Date.parse("2026-11-13T10:05:00Z") } });
    advance(6 * 60_000);
    tick();
    await new Promise((resolve) => setImmediate(resolve));
    expect(sent.map((item) => item.prompt.content)).toEqual(["Finish the report"]);
    await service.drain("s1");
    expect(sent).toHaveLength(1);
    expect(service.get("s1").held).toBe("Paused after the turn hit a usage limit.");
    service.stop();
  });

  it("rewrites a queued prompt where it stands, and says so when it has already gone", () => {
    const { service } = harness();
    service.apply("s1", { type: "add", prompt: { content: "one", attachments: [] } });
    const two = service.apply("s1", { type: "add", prompt: { content: "two", attachments: [] } }).queue[1]!;
    service.apply("s1", { type: "add", prompt: { content: "three", attachments: [] } });
    const next = service.apply("s1", { type: "replace", id: two.id, prompt: { content: "two, edited", attachments: [] } });
    expect(next.queue.map((item) => [item.id === two.id, item.content])).toEqual([[false, "one"], [true, "two, edited"], [false, "three"]]);
    expect(() => service.apply("s1", { type: "replace", id: "gone", prompt: { content: "x", attachments: [] } })).toThrow(/already been sent/);
    service.stop();
  });

  it("forgets the follow-ups of a conversation that no longer exists", async () => {
    const { service, store } = harness();
    store.set("followups:gone", JSON.stringify({ queue: [{ id: "q", content: "x", attachments: [], createdAt: "2026-11-13T10:00:00Z" }] }));
    await service.drain("gone");
    expect(store.has("followups:gone")).toBe(false);
  });
});

describe("a conversation that cannot start a turn", () => {
  it("waits without sending, so no prompt or failed turn is recorded", async () => {
    const store = new Map<string, string>();
    const sent: string[] = [];
    let blocker: string | undefined = "Codex is installed but not signed in.";
    const service = new FollowUpService({
      read: (key) => store.get(key), write: (key, value) => { store.set(key, value); }, remove: (key) => { store.delete(key); },
      keys: (prefix) => [...store.keys()].filter((key) => key.startsWith(prefix)),
      sessionExists: () => true, isBusy: () => false,
      send: async (_sessionId, prompt) => { sent.push(prompt.content); },
      blocker: () => blocker,
      emit: () => {}, autoResume: () => false, recentRuns: () => [], attachmentsFor: () => [], log: () => {},
    }, { settleMs: 60_000, retryMs: 60_000, tickMs: 60_000 });
    service.apply("s1", { type: "add", prompt: { content: "after login", attachments: [] } });
    await service.drain("s1");
    expect(sent).toEqual([]);
    expect(service.get("s1")).toMatchObject({ queue: [{ content: "after login" }], blocked: "Codex is installed but not signed in." });
    blocker = undefined;
    await service.drain("s1");
    expect(sent).toEqual(["after login"]);
    expect(service.get("s1").blocked).toBeUndefined();
    service.stop();
  });
});
