import { createInterface } from "node:readline";
import process from "node:process";
import { setTimeout } from "node:timers";
const scenario = process.argv[2] ?? "normal";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const reply = (id, result) => send({ id, result });
let initialized = false;
let threadId = "native-thread";
let turnId;
let counter = 0;
let model = "model-one";
let approvalId;
let archived = scenario.startsWith("archived");
const notify = (method, params) => send({ method, params: { threadId, turnId, ...params } });
const finish = (status = "completed", message) => notify("turn/completed", { turn: { id: turnId, status, error: message ? { message } : null } });
const respond = () => {
  send({ method: "item/agentMessage/delta", params: { threadId: "foreign", turnId, itemId: "foreign", delta: "Wrong thread" } });
  notify("turn/plan/updated", { plan: [{ step: "Inspect", status: "completed" }] });
  notify("item/started", { item: { type: "commandExecution", id: "command", command: "pwd", status: "inProgress" } });
  notify("item/completed", { item: { type: "commandExecution", id: "command", command: "pwd", status: "completed", exitCode: scenario === "command-failed" ? 1 : 0, aggregatedOutput: "/fixture" } });
  notify("item/agentMessage/delta", { itemId: "answer", delta: `Hello ${model}` });
  notify("item/completed", { item: { id: "answer", type: "agentMessage", text: `Hello ${model}` } });
  notify("thread/tokenUsage/updated", { tokenUsage: { total: { totalTokens: 100 }, last: { inputTokens: 8, outputTokens: 12, totalTokens: 20, cachedInputTokens: 3 }, modelContextWindow: 1000 } });
  finish();
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  const { id, method, params = {} } = message;
  if (method === "initialize") {
    if (scenario === "hang") return;
    if (scenario === "malformed") { process.stdout.write("not json\n"); return; }
    reply(id, { userAgent: "fixture" });
  } else if (method === "initialized") initialized = true;
  else if (!initialized) send({ id, error: { code: -32000, message: "Not initialized" } });
  else if (method === "model/list") reply(id, { data: [{ id: "model-one", model: "model-one", displayName: "One" }, { id: "model-two", model: "model-two", displayName: "Two" }], nextCursor: null });
  else if (method === "thread/start" || method === "thread/resume") {
    if (params.sandbox !== "read-only" || params.approvalPolicy !== "untrusted" || params.approvalsReviewer !== "user") throw new Error("Unsafe policy");
    if (method === "thread/resume" && params.threadId !== "native-thread") { send({ id, error: { code: -32000, message: "Session not found" } }); return; }
    if (method === "thread/resume" && archived) { send({ id, error: { code: -32000, message: "session native-thread is archived; run codex unarchive" } }); return; }
    if (scenario === "wrong-id") threadId = "different-thread";
    model = params.model ?? model;
    notify("item/agentMessage/delta", { itemId: "history", delta: "Old history must not replay" });
    reply(id, { thread: { id: threadId, ephemeral: scenario === "ephemeral", status: { type: scenario === "active" ? "active" : "idle" } }, model, cwd: scenario === "wrong-folder" ? "/other" : params.cwd });
  } else if (method === "thread/unarchive") {
    if (!archived || params.threadId !== "native-thread") throw new Error("Unexpected unarchive");
    if (scenario === "archived-denied") { send({ id, error: { code: -32000, message: "Unarchive denied" } }); return; }
    archived = scenario === "archived-still";
    reply(id, {});
  } else if (method === "turn/start") {
    turnId = `turn-${++counter}`;
    model = params.model ?? model;
    const acknowledge = () => reply(id, { turn: { id: turnId, status: "inProgress" } });
    if (scenario !== "early") acknowledge();
    notify("turn/started", { turn: { id: turnId, status: "inProgress" } });
    if (scenario === "exit") { process.exit(1); return; }
    if (scenario === "fail") { finish("failed", "Model unavailable for this account"); return; }
    if (["wait", "slow-interrupt", "missing-interrupt"].includes(scenario)) return;
    if (scenario === "image" && !params.input.some((block) => block.type === "image" && block.url === "data:image/png;base64,aW1hZ2U=")) throw new Error("Missing image");
    if (scenario === "approval" || scenario === "file-approval" || scenario === "unsupported") {
      approvalId = 900 + counter;
      send({ id: approvalId, method: scenario === "unsupported" ? "item/tool/requestUserInput" : scenario === "file-approval" ? "item/fileChange/requestApproval" : "item/commandExecution/requestApproval", params: { threadId, turnId, itemId: "command", command: "pwd", reason: "Inspect the working folder", availableDecisions: ["accept", "decline", "cancel"] } });
      return;
    }
    respond();
    if (scenario === "early") acknowledge();
  } else if (method === "turn/interrupt") {
    reply(id, {});
    if (scenario === "missing-interrupt") return;
    if (scenario === "slow-interrupt") setTimeout(() => finish("interrupted"), 150);
    else finish("interrupted");
  }
  else if (id === approvalId) {
    const decision = message.result?.decision;
    notify("serverRequest/resolved", { requestId: id });
    if (decision === "accept") respond();
    else if (decision === "decline" || decision === "cancel") finish("interrupted");
    else throw new Error("Approval widened beyond one command");
  }
});
