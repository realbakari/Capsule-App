import { mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as terminal from "@capsule/terminal";
import * as filesystem from "@capsule/filesystem";
import type { CapsuleSettings, Run } from "@capsule/shared";
import type { FolderActivity } from "./folder-activity.js";
import { CapsuleEngine } from "./engine.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-desktop-readiness-"));
  const engine = new CapsuleEngine({ databasePath: path.join(directory, "state.sqlite"), userDataDir: directory, autoConnect: false });
  cleanups.push(async () => { await engine.stop(); rmSync(directory, { recursive: true, force: true }); });
  await engine.start();
  const project = engine.createProject({ name: "Fixture", workingDirectory: directory });
  const session = await engine.createSession({ projectId: project.id, mode: "chat" });
  return { directory, engine, project, session };
}

it("reads only a recorded image attachment and rechecks its file type and size", async () => {
  const { directory, engine, session } = await fixture();
  const image = path.join(directory, "image.png");
  writeFileSync(image, "fixture image bytes");
  engine.repos.insertMessage({ id: "image-message", sessionId: session.id, role: "user", content: "See image", createdAt: new Date().toISOString(),
    attachments: engine.validateAttachments([{ name: "image.png", path: image }]) });
  expect((await engine.readMessageImage("image-message", 0))?.toString()).toBe("fixture image bytes");
  expect(await engine.readMessageImage(image, 0)).toBeUndefined();
  expect(await engine.readMessageImage("image-message", -1)).toBeUndefined();
  expect(await engine.readMessageImage("image-message", 1)).toBeUndefined();
  truncateSync(image, 21 * 1024 * 1024);
  await expect(engine.readMessageImage("image-message", 0)).rejects.toThrow("too large");
  rmSync(image);
  await expect(engine.readMessageImage("image-message", 0)).rejects.toThrow();
  const other = path.join(directory, "other.png"); writeFileSync(other, "replacement"); symlinkSync(other, image);
  await expect(engine.readMessageImage("image-message", 0)).rejects.toThrow();
});

it("rejects update restart during work and waits for saved checkpoints without cancelling runs", async () => {
  const { engine, project, session } = await fixture();
  const now = new Date().toISOString();
  const run: Run = { id: "active-run", sessionId: session.id, projectId: project.id, agentId: "general", prompt: "Work", status: "running", createdAt: now, updatedAt: now };
  engine.repos.insertRun(run);
  await expect(engine.prepareForUpdate()).rejects.toThrow("Finish or stop");
  expect(engine.getRun(run.id)?.status).toBe("running");
  engine.repos.updateRun({ ...run, status: "completed" });
  const internal = engine as unknown as { checkpointPending: Map<string, Promise<void>> };
  let finish!: () => void;
  internal.checkpointPending.set("fixture", new Promise((resolve) => { finish = resolve; }));
  let ready = false;
  const preparing = engine.prepareForUpdate().then(() => { ready = true; });
  await Promise.resolve(); expect(ready).toBe(false);
  finish(); await preparing;
  expect(ready).toBe(true);
  expect(engine.listSessions(project.id)).toHaveLength(1); // Engine stays usable if native installation fails.
});

it("includes Inspector commands in update readiness until completion, including failure", async () => {
  const { engine, project, session } = await fixture();
  let reject!: (error: Error) => void;
  vi.spyOn(terminal, "runInDirectory").mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const command = engine.execInProject(project.id, "fixture command", session.id);
  await expect(engine.prepareForUpdate()).rejects.toThrow("Finish or stop");
  const failed = expect(command).rejects.toThrow("Command failed");
  reject(new Error("Command failed"));
  await failed;
  await expect(engine.prepareForUpdate()).resolves.toBeUndefined();
});

it("holds execution admission through staging and releases it idempotently on failure", async () => {
  const { engine, project, session, directory } = await fixture();
  const release = engine.reserveForUpdate();
  await engine.prepareForUpdate();
  await expect(engine.sendMessage({ sessionId: session.id, content: "No write", mode: "chat" })).rejects.toThrow("preparing to restart");
  await expect(engine.execInProject(project.id, "unused")).rejects.toThrow("preparing to restart");
  expect(() => engine.beginLocalCommand(directory)).toThrow("preparing to restart");
  expect(() => engine.writeFile(project.id, "unused.txt", "No write")).toThrow("preparing to restart");
  expect(engine.listMessages(session.id)).toEqual([]);
  release();
  const secondRelease = engine.reserveForUpdate();
  release(); // A late cleanup from the first attempt cannot unlock the second.
  expect(() => engine.beginLocalCommand(directory)).toThrow("preparing to restart");
  secondRelease();
  const finish = engine.beginLocalCommand(directory);
  await expect(engine.prepareForUpdate()).rejects.toThrow("Finish or stop");
  finish();
  await expect(engine.prepareForUpdate()).resolves.toBeUndefined();
});

it("counts restores and prompts still being admitted before any run is recorded", async () => {
  const { engine, directory, session } = await fixture();
  const internal = engine as unknown as { folderActivity: FolderActivity; admittingSessions: Set<string> };
  const finishRestore = internal.folderActivity.restore(directory);
  await expect(engine.prepareForUpdate()).rejects.toThrow("Finish or stop");
  finishRestore();
  internal.admittingSessions.add(session.id);
  await expect(engine.prepareForUpdate()).rejects.toThrow("Finish or stop");
  internal.admittingSessions.delete(session.id);
  await expect(engine.prepareForUpdate()).resolves.toBeUndefined();
});

it("keeps background pull-request operations inside restart admission", async () => {
  const { engine, project, directory } = await fixture();
  const internal = engine as unknown as { settings: CapsuleSettings; folderActivity: FolderActivity; tickPrWatch(projectId: string): Promise<void> };
  internal.settings.prAutoMerge = true;
  const poll = vi.spyOn(filesystem, "pollPullRequest").mockResolvedValue({ known: true, value: {
    number: 1, url: "https://example.test/pull/1", state: "OPEN", checks: "success",
  } } as Awaited<ReturnType<typeof filesystem.pollPullRequest>>);
  let finish!: () => void;
  vi.spyOn(filesystem, "mergePullRequest").mockImplementationOnce(() => new Promise((resolve) => {
    finish = () => resolve({ ok: true, detail: "Merged fixture" });
  }));
  const watching = internal.tickPrWatch(project.id);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await expect(engine.prepareForUpdate()).rejects.toThrow("Finish or stop");
  finish();
  await watching;
  await engine.prepareForUpdate();
  const release = engine.reserveForUpdate();
  await internal.tickPrWatch(project.id);
  expect(poll).toHaveBeenCalledOnce();
  release();
  const finishRestore = internal.folderActivity.restore(directory);
  await expect(internal.tickPrWatch(project.id)).resolves.toBeUndefined();
  expect(poll).toHaveBeenCalledOnce();
  finishRestore();
});
