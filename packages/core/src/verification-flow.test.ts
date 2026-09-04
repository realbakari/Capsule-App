import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { CapsuleEngine } from "./engine.js";

it("persists a check on its owning turn, coalesces repeat clicks, and never follows a project folder change", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "capsule-check-profile-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "capsule-check-worktree-"));
  execFileSync("git", ["init", "-q"], { cwd });
  writeFileSync(path.join(cwd, "source.txt"), "source\n");
  const options = { databasePath: path.join(profile, "capsule.sqlite"), userDataDir: profile, autoConnect: false };
  let engine = new CapsuleEngine(options);
  await engine.start();
  try {
    const project = engine.createProject({ name: "Evidence", workingDirectory: cwd, defaultMode: "code" });
    engine.updateProject(project.id, { actions: [{ id: "test", name: "Test", command: "printf 'passed'" }] });
    const session = await engine.createSession({ projectId: project.id, mode: "code", agentId: "coding" });
    const { run } = await engine.sendMessage({ sessionId: session.id, content: "Change source", mode: "code", agentId: "coding" });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Turn did not complete")), 5000);
      const poll = () => { if (engine.getRun(run.id)?.status === "completed") { clearTimeout(timer); engine.events.off("run", poll); resolve(); } };
      engine.events.on("run", poll); poll();
    });
    expect(engine.getRun(run.id)?.verification?.status).toBe("unverified");
    const first = engine.verifyRun(run.id, "test");
    expect(engine.verifyRun(run.id, "test")).toBe(first);
    const result = await first;
    expect(result.status).toBe("passed"); expect(result.evidence?.exitCode).toBe(0);
    expect(engine.getRun(run.id)?.status).toBe("completed");
    expect(engine.listRunEvents(run.id).filter((event) => event.type === "verification")).toHaveLength(1);
    engine.updateProject(project.id, { actions: [{ id: "wait", name: "Wait", command: "sleep 10" }] });
    const pending = engine.verifyRun(run.id, "wait");
    engine.cancelVerification(run.id);
    expect((await pending).status).toBe("unverified");
    expect(engine.getRun(run.id)?.verification?.inProgress).not.toBe(true);
    engine.updateProject(project.id, { actions: [{ id: "test", name: "Test", command: "printf 'passed'" }] });
    await engine.verifyRun(run.id, "test");
    const other = mkdtempSync(path.join(tmpdir(), "capsule-check-other-"));
    engine.updateProject(project.id, { workingDirectory: other });
    expect((await engine.verifyRun(run.id)).status).toBe("passed");
    expect(engine.getRun(run.id)?.verification?.evidence?.revision).toEqual(result.evidence?.revision);
    writeFileSync(path.join(cwd, "source.txt"), "newer\n");
    const capture = (engine as unknown as { captureTurnCheckpoint: (savedRun: typeof run, savedSession: typeof session) => void }).captureTurnCheckpoint.bind(engine);
    capture(run, session); // A late frame still holding the original run object.
    expect((await engine.verifyRun(run.id)).status).toBe("stale");
    await engine.stop();
    engine = new CapsuleEngine(options); await engine.start();
    expect(engine.getRun(run.id)?.verification?.status).toBe("stale");
    expect(engine.getRun(run.id)?.verification?.evidence?.command).toBe("printf 'passed'");
  } finally { await engine.stop(); }
});
