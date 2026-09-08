import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DirectAcpHost, DirectAcpSession } from "@capsule/acp";
import type { Run, RunEvent, Session } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  vi.restoreAllMocks();
});

/** Exercise the real protocol → session → host → persisted reply path, without a CLI. */
async function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-direct-replies-"));
  const engine = new CapsuleEngine({ databasePath: path.join(directory, "state.sqlite"), userDataDir: directory, autoConnect: false });
  disposals.push(async () => { await engine.stop(); rmSync(directory, { recursive: true, force: true }); });
  await engine.start();
  const project = engine.createProject({ name: "Reply boundaries", workingDirectory: directory });
  const thread = await engine.createSession({ projectId: project.id, mode: "chat" });
  const internal = engine as unknown as {
    usingMock: boolean;
    direct: DirectAcpHost;
    repos: { updateSession(session: Session): void; insertRun(run: Run): void };
    bindAcpReplies(): void;
    handleRuntimeEvent(session: Session, run: Run, event: RunEvent, stop: () => void): Promise<void>;
  };
  const key = "direct:acp:grok:reply-boundaries";
  thread.openclawSessionKey = key;
  internal.repos.updateSession(thread);
  const createdAt = new Date().toISOString();
  const run: Run = { id: "reply-run", projectId: project.id, sessionId: thread.id, agentId: "grok", prompt: "Review files", status: "running", createdAt, updatedAt: createdAt };
  internal.repos.insertRun(run);
  internal.usingMock = false;
  internal.bindAcpReplies();

  const session = new DirectAcpSession({ command: "unused-fixture", args: [] });
  const permissionResponses = vi.spyOn(session as unknown as { respond(id: number | string, result: unknown): void }, "respond");
  const protocol = session as unknown as {
    acpSessionId: string;
    handle(message: { jsonrpc: "2.0"; id?: number; method: string; params: unknown }): void;
  };
  protocol.acpSessionId = "fixture";
  const host = internal.direct as unknown as {
    sessions: Map<string, DirectAcpSession>;
    wire(key: string, session: DirectAcpSession): void;
  };
  host.wire(key, session);
  host.sessions.set(key, session);
  let resolve!: (result: { stopReason?: string }) => void;
  let reject!: (error: Error) => void;
  vi.spyOn(session, "prompt").mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const sending = internal.direct.send(key, "Review files");
  // Keep same-tick fixture messages ordered when reloading a keyset history page.
  let timestamp = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => ++timestamp);
  const update = (sessionUpdate: string, fields: Record<string, unknown>, sessionId = "fixture") => {
    protocol.handle({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate, ...fields } } });
  };
  const text = (value: string) => update("agent_message_chunk", { content: { type: "text", text: value } });
  const permission = (sessionId = "fixture") => protocol.handle({
    jsonrpc: "2.0", id: 99, method: "session/request_permission", params: {
      sessionId, toolCall: { title: "Write file" },
      options: [{ kind: "allow_once", optionId: "once" }, { kind: "reject_once", optionId: "deny" }],
    },
  });
  const messages = () => engine.listMessages(thread.id).map((message) => message.content);
  return { engine, internal, thread, run, update, text, permission, permissionResponses, messages, sending, resolve, reject };
}

it("keeps progress separate from the final reply while preserving token and code chunks", async () => {
  const f = await fixture();
  let boundaryCount = 0;
  f.internal.direct.onAcpReply((reply) => { if (reply.done) boundaryCount++; });
  f.text("Checking ");
  f.text("files.");
  f.update("tool_call", { toolCallId: "read", title: "Read files" }, "other-session");
  expect(f.messages()).toEqual([]);
  f.update("tool_call", { toolCallId: "read", title: "Read files" });
  expect(f.messages()).toEqual(["Checking files."]);
  expect(f.engine.getRun(f.run.id)?.status).toBe("running");
  f.update("tool_call", { toolCallId: "second-read", title: "Read another file" });
  expect(f.messages()).toEqual(["Checking files."]);
  expect(boundaryCount).toBe(1);

  f.text("The files are loaded.");
  f.update("agent_thought_chunk", { content: { type: "text", text: "Private reasoning" } });
  expect(f.messages()).toEqual(["Checking files.", "The files are loaded."]);
  for (let index = 0; index < 100; index++) {
    f.update("agent_thought_chunk", { content: { type: "text", text: "More reasoning" } });
  }
  expect(boundaryCount).toBe(2);
  f.text("Final answer.\n\n```ts\nconst va");
  // Background tool telemetry must not split a word or code block in the answer.
  f.update("tool_call_update", { toolCallId: "read", status: "completed" });
  f.update("usage_update", { used: 10, size: 100 });
  f.text("lue = 1;\n```");
  f.resolve({ stopReason: "end_turn" });
  await f.sending;
  const expected = ["Checking files.", "The files are loaded.", "Final answer.\n\n```ts\nconst value = 1;\n```"];
  expect(f.messages()).toEqual(expected);
  expect(f.engine.getRun(f.run.id)?.result).toBe(expected.join("\n\n"));
  await f.internal.handleRuntimeEvent(f.thread, f.run, {
    id: "end", runId: f.run.id, type: "lifecycle", message: "Completed", timestamp: new Date().toISOString(), data: { status: "completed" },
  }, () => {});
  expect(f.engine.getRun(f.run.id)?.result).toBe(expected.join("\n\n"));
  expect(f.engine.listMessagePage(f.thread.id).messages.map((message) => message.content)).toEqual(expected);
});

it("flushes an interrupted final segment without duplicating earlier progress", async () => {
  const f = await fixture();
  f.text("Checking files.");
  f.update("tool_call", { toolCallId: "read", title: "Read files" });
  f.text("Partial answer");
  f.reject(new Error("Disconnected"));
  await expect(f.sending).rejects.toThrow("Disconnected");
  expect(f.messages()).toEqual(["Checking files.", "Partial answer"]);
  expect(f.engine.getRun(f.run.id)?.result).toBe("Checking files.\n\nPartial answer");
});

it.each(["unknown command", "failed to spawn", "No API key found", "ACP status:"])("keeps diagnostic prose containing %s without ending the direct turn", async (diagnostic) => {
  const f = await fixture();
  const progress = `The log says ${diagnostic}. I will inspect the configuration.`;
  f.text(progress);
  f.update("tool_call", { toolCallId: "inspect", title: "Inspect configuration" });
  expect(f.engine.getRun(f.run.id)).toMatchObject({ status: "running" });
  expect(f.engine.getRun(f.run.id)?.completedAt).toBeFalsy();
  f.text("Fixed the configuration.");
  f.resolve({ stopReason: "end_turn" });
  await f.sending;
  await f.internal.handleRuntimeEvent(f.thread, f.run, {
    id: "end", runId: f.run.id, type: "lifecycle", message: "Completed", timestamp: new Date().toISOString(), data: { status: "completed" },
  }, () => {});
  expect(f.messages()).toEqual([progress, "Fixed the configuration."]);
  expect(f.engine.getRun(f.run.id)).toMatchObject({ status: "completed", result: `${progress}\n\nFixed the configuration.` });
});

it("uses message IDs to separate replies without splitting token chunks around tools", async () => {
  const f = await fixture();
  const chunk = (messageId: string, text: string, sessionId?: string) => f.update("agent_message_chunk", {
    messageId, content: { type: "text", text },
  }, sessionId);
  chunk("progress", "Checking ");
  chunk("unrelated", "Wrong session", "another-session");
  chunk("progress", "files.");
  expect(f.messages()).toEqual([]);
  chunk("answer", "```ts\nconst va");
  expect(f.messages()).toEqual(["Checking files."]);
  f.update("tool_call", { toolCallId: "background", title: "Background operation" });
  f.update("tool_call_update", { toolCallId: "background", status: "completed" });
  chunk("answer", "lue = 1;\n```");
  // An empty first chunk can still announce a distinct message.
  chunk("summary", "");
  chunk("summary", "Done.");
  f.resolve({ stopReason: "end_turn" });
  await f.sending;
  const expected = ["Checking files.", "```ts\nconst value = 1;\n```", "Done."];
  expect(f.messages()).toEqual(expected);
  expect(f.engine.getRun(f.run.id)?.result).toBe(expected.join("\n\n"));
});

it("retains a genuine one-character answer instead of treating it as UI noise", async () => {
  const f = await fixture();
  f.text("0");
  f.resolve({ stopReason: "end_turn" });
  await f.sending;
  expect(f.messages()).toEqual(["0"]);
});

it("ends the progress message before an approval without completing the turn", async () => {
  const f = await fixture();
  f.text("The file needs permission.");
  f.permission("other-session");
  expect(f.messages()).toEqual([]);
  expect(f.engine.listApprovals("pending")).toEqual([]);
  f.permission();
  expect(f.messages()).toEqual(["The file needs permission."]);
  expect(f.engine.getRun(f.run.id)?.status).toBe("approval_required");
  const approval = f.engine.listApprovals("pending")[0]!;
  await f.engine.resolveApproval(approval.id, "approved_once");
  f.text("The file is updated.");
  f.resolve({ stopReason: "end_turn" });
  await f.sending;
  expect(f.messages()).toEqual(["The file needs permission.", "The file is updated."]);
});

it.each(["stop", "output-limit", "completion"])("cancels pending permission outcomes on %s, without selecting denial", async (ending) => {
  const f = await fixture();
  f.permission();
  const approval = f.engine.listApprovals("pending")[0]!;
  const cancel = vi.spyOn(f.internal.direct, "cancelAcp").mockResolvedValue();
  if (ending === "stop") await f.engine.stopRun(f.run.id);
  else if (ending === "output-limit") f.text("x".repeat(1024 * 1024 + 1));
  else await f.internal.handleRuntimeEvent(f.thread, f.run, {
    id: "end", runId: f.run.id, type: "lifecycle", message: "Completed", timestamp: new Date().toISOString(), data: { status: "completed" },
  }, () => {});
  expect(f.permissionResponses.mock.calls).toEqual([[99, { outcome: { outcome: "cancelled" } }]]);
  expect(f.engine.listApprovals("cancelled").map((item) => item.id)).toEqual([approval.id]);
  await expect(f.engine.resolveApproval(approval.id, "approved_once")).rejects.toThrow("not found");
  expect(f.permissionResponses).toHaveBeenCalledOnce();
  if (ending !== "completion") expect(cancel).toHaveBeenCalledOnce();
  if (ending === "output-limit") expect(f.engine.getRun(f.run.id)).toMatchObject({ status: "failed", error: expect.stringContaining("Cancellation was requested") });
  f.resolve({ stopReason: "end_turn" });
  await f.sending;
});
