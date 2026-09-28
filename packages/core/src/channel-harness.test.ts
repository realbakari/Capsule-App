import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CapsuleEngine } from "./engine.js";
import type { ChannelHarnessInput } from "@capsule/shared";

const messageId = "a".repeat(64), rootId = "b".repeat(64), author = "c".repeat(64);
const channelId = "11111111-2222-3333-4444-555555555555";
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); vi.restoreAllMocks(); });
async function fixture(content = "Review this project") {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-channel-harness-"));
  const engine = new CapsuleEngine({ databasePath: path.join(directory, "state.sqlite"), userDataDir: directory, autoConnect: false });
  disposals.push(async () => { await engine.stop(); rmSync(directory, { recursive: true, force: true }); });
  await engine.start();
  const project = engine.createProject({ name: "Channel fixture", workingDirectory: directory });
  const status = vi.spyOn(engine.sharedChannels, "status").mockReturnValue({ connected: true, url: "https://relay.example" });
  const channels = vi.spyOn(engine.sharedChannels, "channels").mockResolvedValue([{ id: channelId, name: "fixture", description: "", joined: true }]);
  const messages = vi.spyOn(engine.sharedChannels, "messages").mockResolvedValue([{ id: messageId, author, content, createdAt: 1, rootId }]);
  const post = vi.spyOn(engine.sharedChannels, "post").mockResolvedValue("d".repeat(64));
  const input: ChannelHarnessInput = { channelId, messageId, rootId, projectId: project.id, harnessId: "codex" };
  return { engine, status, channels, messages, post, input, job: () => engine.channelHarness.list(channelId, messageId)[0]! };
}

it("runs an explicitly selected relay message through the workspace with supervised permissions and shares only on request", async () => {
  const f = await fixture();
  const [first, duplicate] = await Promise.all([f.engine.channelHarness.start(f.input), f.engine.channelHarness.start(f.input)]);
  expect(first.id).toBe(duplicate.id);
  await expect.poll(() => f.job().status, { timeout: 5000 }).toBe("completed");
  const job = f.job();
  expect(f.engine.listRuns(job.sessionId)).toHaveLength(1);
  const session = f.engine.listSessions().find((session) => session.id === job.sessionId)!;
  expect(session.permissionProfile).toBe("strict");
  expect(session.workspaceMode).toBe("local");
  expect(session.harnessId).toBe("codex");
  expect(f.engine.getRun(job.runId!)?.prompt).toBe("Review this project");
  expect(f.post).not.toHaveBeenCalled();
  const shared = await f.engine.channelHarness.share(job.id, "Reviewed result");
  expect(shared.publication).toBe("shared");
  expect(f.post).toHaveBeenCalledWith({ channelId, replyTo: rootId, content: "Capsule · codex\n\nReviewed result", mentions: [] });
  await f.engine.channelHarness.share(job.id, "Reviewed result");
  expect(f.post).toHaveBeenCalledOnce();
});

it("refuses unjoined or missing messages before starting a local conversation", async () => {
  const f = await fixture();
  f.channels.mockResolvedValue([]);
  await expect(f.engine.channelHarness.start(f.input)).rejects.toThrow("Join this channel");
  f.channels.mockResolvedValue([{ id: channelId, name: "fixture", description: "", joined: true }]);
  f.messages.mockResolvedValue([]);
  await expect(f.engine.channelHarness.start(f.input)).rejects.toThrow("no longer");
  expect(f.engine.listSessions(f.input.projectId)).toHaveLength(0);
  expect(() => f.engine.channelHarness.start({ ...f.input, harnessId: "coding" } as unknown as ChannelHarnessInput)).toThrow("harness");
  expect(() => f.engine.channelHarness.start({} as ChannelHarnessInput)).toThrow("harness");
});

it("rejects stale connection reads and never starts or posts after identity replacement", async () => {
  const f = await fixture();
  f.messages.mockImplementation(async () => { f.engine.sharedChannels.disconnect(); return [{ id: messageId, author, content: "Hi", createdAt: 1 }]; });
  await expect(f.engine.channelHarness.start(f.input)).rejects.toThrow("connection changed");
  expect(f.engine.listSessions(f.input.projectId)).toHaveLength(0);
  expect(f.post).not.toHaveBeenCalled();
});

it("does not retry an uncertain publication or deliver a completed run under a reconnected identity", async () => {
  const f = await fixture();
  await f.engine.channelHarness.start(f.input);
  await expect.poll(() => f.job().status, { timeout: 5000 }).toBe("completed");
  const job = f.job();
  f.post.mockRejectedValue(new Error("timeout"));
  await expect(f.engine.channelHarness.share(job.id, "Reply")).rejects.toThrow("could not be confirmed");
  await expect(f.engine.channelHarness.share(job.id, "Reply")).rejects.toThrow("already submitted");
  expect(f.post).toHaveBeenCalledOnce();
  f.engine.sharedChannels.disconnect();
  expect(f.engine.channelHarness.list(channelId, messageId)).toEqual([]);
  await expect(f.engine.channelHarness.share(job.id, "Reply")).rejects.toThrow("connection changed");
});

it("keeps a failed run inspectable and never shares its error as a successful reply", async () => {
  const f = await fixture("[fail]");
  await f.engine.channelHarness.start(f.input);
  await expect.poll(() => f.job().status, { timeout: 5000 }).toBe("failed");
  expect(f.job().runId).toBeTruthy();
  await expect(f.engine.channelHarness.share(f.job().id, "Reply")).rejects.toThrow("successful run");
  expect(f.post).not.toHaveBeenCalled();
});

it("reports harness startup failures without discarding the new conversation", async () => {
  const f = await fixture();
  vi.spyOn(f.engine, "sendMessage").mockRejectedValue(new Error("The adapter needs an update"));
  await f.engine.channelHarness.start(f.input);
  await expect.poll(() => f.job().status).toBe("failed");
  expect(f.job().sessionId).toBeTruthy();
  expect(f.job().error).toBe("The adapter needs an update");
  expect(f.post).not.toHaveBeenCalled();
});

it("explicitly retries a failed attempt once and keeps the previous conversation", async () => {
  const f = await fixture();
  const send = vi.spyOn(f.engine, "sendMessage").mockRejectedValueOnce(new Error("Sign in first"));
  await f.engine.channelHarness.start(f.input);
  await expect.poll(() => f.job().status).toBe("failed");
  const failed = f.job();
  expect((await f.engine.channelHarness.start(f.input)).id).toBe(failed.id);
  const retry = { ...f.input, retryOf: failed.id };
  const [one, two] = await Promise.all([f.engine.channelHarness.start(retry), f.engine.channelHarness.start(retry)]);
  expect(one.id).toBe(two.id);
  expect(one.id).not.toBe(failed.id);
  await expect.poll(() => f.job().status, { timeout: 5000 }).toBe("completed");
  expect(send).toHaveBeenCalledTimes(2);
  expect(f.engine.channelHarness.list(channelId, messageId)).toHaveLength(2);
  expect((await f.engine.channelHarness.start(retry)).id).toBe(one.id);
  expect(() => f.engine.channelHarness.start({ ...retry, retryOf: one.id })).toThrow("Only a failed");
  expect(f.post).not.toHaveBeenCalled();
});

it("admits only one publication while the relay acknowledgement is pending", async () => {
  const f = await fixture();
  await f.engine.channelHarness.start(f.input);
  await expect.poll(() => f.job().status, { timeout: 5000 }).toBe("completed");
  let acknowledge!: (id: string) => void;
  f.post.mockReturnValue(new Promise((resolve) => { acknowledge = resolve; }));
  const first = f.engine.channelHarness.share(f.job().id, "Reviewed reply");
  await expect(f.engine.channelHarness.share(f.job().id, "Duplicate")).rejects.toThrow("already submitted");
  acknowledge("d".repeat(64));
  await first;
  expect(f.post).toHaveBeenCalledOnce();
});
