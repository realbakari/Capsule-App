import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CapsuleEngine } from "./engine.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });
async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule platform flow "));
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "state.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  cleanup.push(async () => { await engine.stop(); rmSync(dir, { recursive: true, force: true }); });
  const project = engine.createProject({ name: "Platform fixture", workingDirectory: dir });
  return { dir, engine, project };
}

it("creates a workspace and first-prompt title, settles a mock turn, and retains attachments", async () => {
  const { dir, engine, project } = await fixture();
  const session = await engine.createSession({ projectId: project.id, mode: "chat" });
  const file = path.join(dir, "review brief.md"); writeFileSync(file, "# Review brief\n");
  const sent = await engine.sendMessage({ sessionId: session.id, mode: "chat", content: "## Review the composer\nExtra context",
    attachments: [{ path: file, name: "review brief.md", size: 15 }] });
  expect(sent.session.title).toBe("Review the composer");
  await vi.waitFor(() => expect(engine.getRun(sent.run.id)?.status).toBe("completed"), { timeout: 5000 });
  expect(engine.listMessages(session.id).some((message) => message.role === "assistant")).toBe(true);
  expect(engine.listMessages(session.id)[0]?.attachments?.[0]?.path).toBe(file);
  expect(engine.regenerateTitle(session.id).title).toBe("Review the composer");
  const second = await engine.sendMessage({ sessionId: session.id, content: "Another request", mode: "chat" });
  expect(second.session.title).toBe("Review the composer");
});

it("regenerates an attachment-only title and preserves manually named conversations", async () => {
  const { dir, engine, project } = await fixture();
  const file = path.join(dir, "design_notes.md"); writeFileSync(file, "brief");
  const session = await engine.createSession({ projectId: project.id, mode: "chat" });
  await engine.sendMessage({ sessionId: session.id, mode: "chat", content: "", attachments: [{ path: file, name: "design_notes.md", size: 5 }] });
  expect(engine.regenerateTitle(session.id).title).toBe("design_notes.md");
  const named = await engine.createSession({ projectId: project.id, mode: "chat", title: "My chosen title" });
  expect((await engine.sendMessage({ sessionId: named.id, content: "Do not rename me", mode: "chat" })).session.title).toBe("My chosen title");
});
