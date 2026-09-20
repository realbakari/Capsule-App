// Protocol-only fixture. No real CLI, credentials, filesystem tools or provider calls.
import readline from "node:readline";
import process from "node:process";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const scenario = process.argv[2] || "normal";
const schema = process.env.MUSE_TEST_SCHEMA;
let model = "model-one";
const statePath = process.env.MUSE_TEST_STATE;
let reasoningEffort = statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")).reasoningEffort : undefined;
let historyReads = 0;
let usageReads = 0;
const quota = (usedPercent, observedAtMs = 1_800_000_000_000) => ({ observedAtMs, tier: "Standard",
  window: { usedPercent, resetsAtMs: observedAtMs + 18_000_000, windowDurationMins: 300 },
  weekly: { usedPercent: 125, resetsAtMs: observedAtMs + 604_800_000 } });
const usageChanged = (value) => emit({ method: "usage/changed", params: value });
let turnId;
let sequence = 0;
let decisions = 0;
let interrupts = 0;
const sessionId = "fixture-session";
const emit = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\n");
const reply = (id, result) => emit({ id, result });
const notify = (method, params) => emit({ method, params: { sessionId, viewCursor: "cursor-" + sequence++, ...params } });
const complete = (terminal = "completed") => notify("turn/completed", { turnId, terminal, usage: { inputTokens: 7, outputTokens: 3, cachedTokens: 2 } });
const item = (text, status = "completed", revision = 2) => ({
  itemId: "message-" + turnId, kind: "agentMessage", turnId, text, status, revision,
});
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params: p = {} } = JSON.parse(line);
  if (!method) return;
  if (method === "initialize") {
    if (p.clientInfo?.name !== "capsule" || p.capabilities?.userInputDialogs !== false) process.exit(10);
    if (scenario === "timeout") return;
    if (scenario === "disabled") { process.exit(5); return; }
    return reply(id, { schema: { version: 1, fingerprint: schema }, serverInfo: { name: "fixture", version: "1" },
      ...(scenario === "default-durable" ? {} : { sessionDurability: scenario === "ephemeral" ? "ephemeral" : "durable" }) });
  }
  if (method === "initialized") return;
  if (method === "usage/read") {
    if (++usageReads > 1) process.exit(14);
    if (scenario === "usage-unsupported") return emit({ id, error: { code: -32601, message: "Unknown method" } });
    if (scenario === "usage-timeout") return setTimeout(() => reply(id, { usage: quota(10) }), 3_200);
    if (scenario === "usage-race") {
      usageChanged(quota(80));
      usageChanged(quota(80)); // duplicate does not emit twice
      usageChanged(quota(20, 1_700_000_000_000)); // older report
      usageChanged({ ...quota(90), window: {} }); // malformed report
      return setTimeout(() => reply(id, { usage: quota(10) }), 200); // tied timestamp, older read
    }
    return reply(id, scenario.startsWith("usage-") ? { usage: quota(0) } : {});
  }
  if (method === "session/start" || method === "session/resume") {
    if (method === "session/start" && p.approvalMode !== "promptUnmatched") process.exit(9);
    if (scenario === "reasoning-early") {
      notify("session/reasoningEffortChanged", { reasoningEffort: "low" });
      notify("session/reasoningEffortChanged", { sessionId: "foreign", reasoningEffort: "ultra" });
    }
    return reply(id, { session: {
      sessionId: scenario === "wrong-id" ? "another-session" : sessionId,
      workspaceRoot: scenario === "wrong-folder" ? "/" : process.cwd(),
      status: scenario === "unfinished" ? "running" : "idle", activeTurnId: null, modelId: model,
    }, pendingRequests: [], history: { mode: "none", ...(scenario === "unavailable" ? { noneReason: "projectionUnavailable" } : {}) } });
  }
  if (method === "model/list") {
    reply(id, { models: (scenario === "no-models" ? [] : ["model-one", "model-two"]).map((modelId) => ({
      modelId, displayLabel: modelId, providerId: "fixture", isActive: modelId === model,
    })) });
    if (scenario === "usage-idle-exit") setTimeout(() => process.exit(0), 200);
    return;
  }
  if (method === "session/setReasoningEffort") {
    if (scenario === "reasoning-reject") return emit({ id, error: { code: -32602, message: "Reasoning setting is unavailable" } });
    if (scenario === "reasoning-mismatch") return reply(id, { status: "accepted" });
    reasoningEffort = p.reasoningEffort;
    if (statePath) writeFileSync(statePath, JSON.stringify({ reasoningEffort }));
    if (scenario === "reasoning-notification") notify("session/reasoningEffortChanged", { reasoningEffort: "ultra" });
    notify("session/reasoningEffortChanged", { sessionId: "foreign", reasoningEffort: "minimal" });
    notify("session/reasoningEffortChanged", { reasoningEffort: true });
    if (scenario === "reasoning-history-first") return setTimeout(() => reply(id, { commandId: p.commandId, status: "accepted" }), 150);
    return reply(id, { commandId: p.commandId, status: "accepted" });
  }
  if (method === "view/page") {
    if (++historyReads > 1 || p.limit !== 100 || p.direction !== "backward" || p.sessionId !== sessionId) process.exit(13);
    const effort = scenario.startsWith("reasoning-delayed") || scenario === "reasoning-history-first" ? "low" : reasoningEffort;
    const result = { events: effort ? [{ method: "session/reasoningEffortChanged", params: { sessionId, reasoningEffort: effort } }] : [], nextCursor: null };
    if (scenario === "reasoning-delayed") return setTimeout(() => reply(id, result), 250);
    if (scenario === "reasoning-history-first") return setTimeout(() => reply(id, result), 50);
    if (scenario === "reasoning-delayed-timeout") return setTimeout(() => reply(id, result), 3_200);
    if (scenario === "reasoning-unsupported") return emit({ id, error: { code: -32601, message: "Unknown method" } });
    return reply(id, result);
  }
  if (method === "session/setModel") {
    model = p.model.modelId;
    notify("session/modelChanged", { modelId: model });
    return reply(id, { commandId: p.commandId, status: "accepted" });
  }
  if (method === "turn/start") {
    turnId = p.commandId;
    const ack = () => reply(id, { commandId: p.commandId, status: "accepted", disposition: "started", startedNewTurn: true, turnId });
    if (scenario === "early-failure") {
      complete("failed");
      ack();
      return;
    }
    if (scenario !== "early") ack();
    notify("turn/started", { turnId, commandId: p.commandId });
    if (scenario === "wait" || scenario === "concurrent-stop") { interrupts = 0; return; }
    if (scenario === "orphan") {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", 1, 2], env: process.env });
      notify("item/completed", { item: item(String(child.pid)) });
      setTimeout(() => process.exit(1), 30);
      return;
    }
    if (scenario === "die") return process.exit(1);
    if (scenario === "gap") { notify("view/gap", { after: "cursor-old", next: "cursor-new" }); return; }
    if (scenario === "unhealthy") { notify("session/viewHealthChanged", { health: "unavailable" }); return; }
    if (scenario === "oversized") { process.stdout.write("x".repeat(4 * 1024 * 1024 + 1) + "\n"); return; }
    if (scenario === "question") {
      notify("userInput/requested", { turnId, userInputId: "question-one", questions: [] });
      return;
    }
    if (["approval", "no-once", "approval-refresh"].includes(scenario)) {
      const approval = { sessionId, turnId, approvalId: "approval-one", toolCallId: "tool-one", toolName: "write_file",
        rawArgs: '{"path":"file.ts"}', currentRequirementId: { approvalId: "approval-one", sourceIndex: 0 },
        availableChoices: [
          { choiceId: "grant-session", scope: "session", decision: "approvedForSession" },
          ...(scenario !== "no-once" ? [{ choiceId: "grant-once", scope: "once", decision: "approved" }] : []),
          { choiceId: "decline", scope: "once", decision: "abort" },
        ],
      };
      notify("approval/requested", approval);
      emit({ id: 1, method: "approval/request", params: approval });
      if (scenario === "approval-refresh") notify("approval/updated", {
        approvalId: approval.approvalId, currentRequirementId: approval.currentRequirementId,
        availableChoices: approval.availableChoices, subject: { kind: "shell", command: "git status --short" },
      });
      return;
    }
    // Cross-session and old-turn notifications must never reach this reply.
    notify("item/completed", { sessionId: "foreign", item: item("foreign text") });
    notify("item/completed", { item: { ...item("old turn"), turnId: "old-turn" } });
    notify("item/started", { item: item("", "inProgress", 1) });
    const delta = { itemId: "message-" + turnId, field: "text", delta: "Hello ", viewCursor: "duplicate-" + turnId };
    notify("item/delta", delta);
    notify("item/delta", delta);
    notify("item/completed", { item: item("Hello world") });
    notify("item/completed", { item: item("Hello world") });
    notify("item/completed", { item: { itemId: "tool-" + turnId, turnId, kind: "toolCall", revision: 1, status: "completed", tool: "read_file", callId: "call-" + turnId } });
    if (scenario === "image" && p.input[1]?.base64Data !== "aW1hZ2U=") process.exit(8);
    complete(scenario === "failed" ? "failed" : "completed");
    if (scenario === "early") ack();
    return;
  }
  if (method === "turn/interrupt") {
    if (++interrupts > 1) process.exit(11);
    reply(id, { commandId: p.commandId, status: "accepted", turnId });
    setTimeout(() => complete("cancelled"), 30);
    return;
  }
  if (method === "approval/decide") {
    if (++decisions > 1) process.exit(12);
    if (!["grant-once", "decline"].includes(p.choiceId) || p.requirementId.sourceIndex !== 0) process.exit(7);
    reply(id, { commandId: p.commandId, status: "accepted", terminal: true });
    if (scenario === "approval-refresh") {
      notify("approval/updated", { approvalId: "approval-one", currentRequirementId: p.requirementId,
        availableChoices: [{ choiceId: "decline", scope: "once", decision: "abort" }], subject: { kind: "shell", command: "git status" } });
      setTimeout(() => { notify("approval/resolved", { approvalId: "approval-one" }); complete(); }, 30);
      return;
    }
    notify("approval/resolved", { approvalId: "approval-one" });
    complete();
    return;
  }
  if (method === "userInput/cancel") return reply(id, { commandId: p.commandId, status: "accepted" });
  emit({ id, error: { code: -32601, message: "Unknown fixture method" } });
});
