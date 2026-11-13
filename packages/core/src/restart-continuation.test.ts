import { describe, expect, it } from "vitest";
import { continuationsAfterRestart, RESTART_PREAMBLE } from "./restart-continuation.js";

const now = Date.parse("2026-11-14T12:00:00.000Z");
const turn = (id: string, sessionId: string, createdAt: string, route: "direct" | "gateway" | "local" = "direct") =>
  ({ run: { id, sessionId, prompt: `prompt ${id}`, createdAt }, route });

describe("continuing threads after a restart", () => {
  it("sends each thread's latest interrupted turn again, with its files", () => {
    const plan = continuationsAfterRestart(
      [turn("r1", "a", "2026-11-14T10:00:00.000Z"), turn("r2", "a", "2026-11-14T11:00:00.000Z"), turn("r3", "b", "2026-11-14T11:30:00.000Z", "local")],
      [{ id: "a", state: "active" }, { id: "b", state: "active" }],
      (runId) => (runId === "r2" ? [{ name: "spec.md", path: "/tmp/spec.md" }] as never : []),
      now,
    );
    expect(plan.map((item) => item.sessionId)).toEqual(["a", "b"]);
    expect(plan[0]!.prompt.content).toBe(`${RESTART_PREAMBLE}\n\nprompt r2`);
    expect(plan[0]!.prompt.attachments).toHaveLength(1);
  });

  it("leaves Gateway turns, archived threads and old turns alone", () => {
    const plan = continuationsAfterRestart(
      [turn("g", "gw", "2026-11-14T11:00:00.000Z", "gateway"), turn("x", "gone", "2026-11-14T11:00:00.000Z"), turn("o", "old", "2026-11-12T11:00:00.000Z")],
      [{ id: "gw", state: "active" }, { id: "gone", state: "archived" }, { id: "old", state: "active" }],
      () => [],
      now,
    );
    expect(plan).toEqual([]);
  });
});

describe("the engine after a restart", () => {
  it("queues the interrupted turn when the setting is on", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { CapsuleEngine } = await import("./engine.js");
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-restart-"));
    const open = () => new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
    const first = open();
    await first.start();
    await first.updateSettings({ continueAfterRestart: true });
    const project = first.createProject({ name: "Restart", defaultMode: "chat" });
    const session = await first.createSession({ projectId: project.id, title: "Cut off", mode: "chat", agentId: "general" });
    const internal = first as unknown as { repos: { insertRun(run: unknown): void } };
    const at = new Date().toISOString();
    internal.repos.insertRun({ id: "run_cut", sessionId: session.id, projectId: project.id, agentId: "general", status: "running", prompt: "Refactor the parser", createdAt: at, updatedAt: at });
    await first.stop();

    const second = open();
    await second.start();
    try {
      expect(second.getRun("run_cut")?.status).toBe("cancelled");
      const queue = second.getFollowUps(session.id).queue;
      expect(queue).toHaveLength(1);
      expect(queue[0]!.content).toContain("Refactor the parser");
    } finally {
      await second.stop();
    }
  });
});
