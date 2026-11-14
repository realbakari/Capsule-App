import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CapsuleEngine } from "./engine.js";

vi.setConfig({ testTimeout: 60_000 });

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("continues a thread in a new one on another agent, carrying the edited summary once and linking back", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-handoff-"));
  const folder = path.join(dir, "project");
  mkdirSync(folder);
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "state.sqlite"), userDataDir: dir, autoConnect: false });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => engine.stop());
  await engine.start();
  const project = engine.createProject({ name: "Fixture", workingDirectory: folder });
  const source = await engine.createSession({ projectId: project.id, title: "Parser work", agentId: "claude", mode: "code" });
  const { run } = await engine.sendMessage({ sessionId: source.id, content: "Make the parser stricter", agentId: "claude", mode: "code" });
  await vi.waitFor(() => expect(["completed", "failed"]).toContain(engine.getRun(run.id)?.status), { timeout: 20_000 });

  const draft = engine.handoffDraft(source.id);
  expect(draft.summary).toContain("# Parser work");
  expect(draft.summary).toContain("Make the parser stricter");

  expect(() => engine.handoffSession({ sessionId: source.id, harnessId: "codex", summary: "   " })).toThrow("Write a summary");
  const next = engine.handoffSession({ sessionId: source.id, harnessId: "codex", summary: "The parser now rejects trailing commas." });
  expect(next).toMatchObject({
    title: "Parser work (continued)",
    harnessId: "codex",
    agentId: "codex",
    origin: { kind: "handoff", sessionId: source.id },
    carryOver: { brief: "The parser now rejects trailing commas." },
  });
  expect(engine.listMessages(next.id)).toEqual([]);
  expect(engine.listMessages(source.id).length).toBeGreaterThan(0);

  const first = await engine.sendMessage({ sessionId: next.id, content: "Add tests", agentId: "codex", mode: "code" });
  await vi.waitFor(() => expect(engine.listRunEvents(first.run.id).some((event) => event.message.includes("handoff summary"))).toBe(true), { timeout: 20_000 });
  await vi.waitFor(() => expect(["completed", "failed"]).toContain(engine.getRun(first.run.id)?.status), { timeout: 20_000 });
  expect(engine.listSessions().find((item) => item.id === next.id)?.carryOver?.brief).toBeUndefined();
  expect(engine.listSessions().find((item) => item.id === next.id)?.origin).toMatchObject({ kind: "handoff", sessionId: source.id });
});
