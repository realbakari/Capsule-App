import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { CapsuleEngine } from "./engine.js";

const commands = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("@capsule/terminal", async (original) => ({ ...await original<typeof import("@capsule/terminal")>(), startInDirectory: commands.start }));

async function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-pause-engine-"));
  const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
  run(directory, "init", "-q");
  run(directory, "config", "user.email", "capsule@example.test");
  run(directory, "config", "user.name", "Capsule Test");
  writeFileSync(path.join(directory, "README.md"), "initial\n");
  run(directory, "add", "README.md");
  run(directory, "commit", "-qm", "initial");
  const engine = new CapsuleEngine({ databasePath: ":memory:", userDataDir: directory, autoConnect: false });
  await engine.start();
  const project = engine.createProject({ name: "Pause fixture", workingDirectory: directory });
  engine.updateProject(project.id, { actions: [{ id: "dev", name: "Dev server", command: "fixture" }] });
  const session = await engine.createSession({ projectId: project.id, workspaceMode: "worktree" });
  return { engine, project, session, run, async dispose() { await engine.stop(); rmSync(directory, { recursive: true, force: true }); } };
}

it("pauses a worktree thread: saves its work, stops its own actions, refuses turns, and resumes", async () => {
  const stop = vi.fn();
  commands.start.mockImplementation(() => ({ pid: 4242, stop }));
  const fixture = await setup();
  try {
    const { engine, project, session, run } = fixture;
    const folder = session.workingDirectory!;
    writeFileSync(path.join(folder, "README.md"), "edited in the thread\n");
    writeFileSync(path.join(folder, "notes.txt"), "untracked\n");
    const status = run(folder, "status", "--porcelain");
    engine.runProjectAction(project.id, "dev", session.id);

    const paused = await engine.pauseSession(session.id);
    expect(paused.paused).toMatchObject({ stoppedActions: ["dev"] });
    expect(stop).toHaveBeenCalledOnce();
    expect(run(folder, "status", "--porcelain")).toBe(status);
    expect(run(folder, "rev-parse", "--verify", paused.paused!.ref).trim()).toBeTruthy();
    await expect(engine.sendMessage({ sessionId: session.id, content: "Hello", mode: "chat" })).rejects.toThrow(/paused/);
    // Pausing twice is the same pause.
    expect((await engine.pauseSession(session.id)).paused?.ref).toBe(paused.paused?.ref);

    run(folder, "checkout", "--", ".");
    rmSync(path.join(folder, "notes.txt"));
    const resumed = await engine.resumeSession(session.id);
    expect(resumed.session.paused).toBeUndefined();
    expect(resumed.detail).toMatch(/Restored/);
    expect(readFileSync(path.join(folder, "README.md"), "utf8")).toBe("edited in the thread\n");
    expect(run(folder, "status", "--porcelain")).toBe(status);
  } finally { await fixture.dispose(); }
});

it("refuses to pause a thread on the shared checkout", async () => {
  const fixture = await setup();
  try {
    const local = await fixture.engine.createSession({ projectId: fixture.project.id, workspaceMode: "local" });
    await expect(fixture.engine.pauseSession(local.id)).rejects.toThrow(/own worktree/);
  } finally { await fixture.dispose(); }
});
