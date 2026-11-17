import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const arg = (name) => process.argv.find((value) => value.startsWith(name + "="))?.slice(name.length + 1)
  ?? (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const scenario = process.argv[2];
const sessionId = arg("--resume") ?? arg("--session-id") ?? randomUUID();
let model = arg("--model") ?? "one";
let permissions = arg("--permission-mode");
let effort;
let user;
let request;
let planning = false;
let turns = 0;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const respond = (message, response = {}) => send({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response } });
const failure = (message, error) => send({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error } });
const log = (event) => { if (process.env.CAPSULE_CLAUDE_TEST_LOG) appendFileSync(process.env.CAPSULE_CLAUDE_TEST_LOG, JSON.stringify(event) + "\n"); };
log({ args: process.argv.slice(3) });
const finish = (is_error = false) => {
  const result = JSON.stringify({ model, effort, permissions });
  turns += 1;
  send({ type: "assistant", session_id: sessionId, parent_tool_use_id: null, uuid: randomUUID(), message: { id: "answer", role: "assistant", model,
    usage: { input_tokens: 1000 * turns, cache_read_input_tokens: 200, cache_creation_input_tokens: 30, output_tokens: 5 }, content: [{ type: "text", text: result }] } });
  send({ type: "result", subtype: "success", session_id: sessionId, uuid: randomUUID(), user_message_uuid: user.uuid, is_error,
    result, stop_reason: "end_turn", duration_ms: 10, duration_api_ms: 5, num_turns: 1, total_cost_usd: 0,
    usage: { input_tokens: 4, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: { [model]: { inputTokens: 1000, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0, contextWindow: 200000, maxOutputTokens: 32000 } }, permission_denials: [] });
};
const result = (fields) => send({ type: "result", subtype: "success", session_id: sessionId, uuid: randomUUID(), is_error: false, result: "", stop_reason: "end_turn",
  duration_ms: 10, duration_api_ms: 5, num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  modelUsage: {}, permission_denials: [], ...fields });
let wakeRequest;
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line); log(message);
  if (message.type === "control_request") {
    const type = message.request.subtype;
    if (type === "initialize") {
      if (scenario === "hang") return;
      respond(message, { commands: [], agents: [], output_style: "default", available_output_styles: [], account: {}, claude_code_version: "fixture",
        models: [{ value: "one", displayName: "One", description: "", supportsEffort: true, supportedEffortLevels: ["low", "high"], supportsAutoMode: true },
          { value: "two", displayName: "Two", description: "", supportsEffort: false }] });
    } else if (type === "set_model") {
      if (scenario === "reject") failure(message, "Model denied");
      else { model = message.request.model; effort = undefined; respond(message); }
    } else if (type === "set_permission_mode") { permissions = message.request.mode; respond(message); }
    else if (type === "apply_flag_settings") { effort = message.request.settings.effortLevel; respond(message); }
    else if (type === "interrupt") { respond(message); if (user) finish(); }
    else failure(message, "Unsupported control");
  } else if (message.type === "user") {
    if (scenario === "probe") throw new Error("Discovery sent a prompt");
    user = message;
    if (process.env.CLAUDE_CONFIG_DIR) {
      const folder = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", process.cwd().replace(/[^a-zA-Z0-9]/g, "-"));
      mkdirSync(folder, { recursive: true });
      appendFileSync(path.join(folder, sessionId + ".jsonl"), JSON.stringify({ ...message, sessionId, cwd: process.cwd(), timestamp: new Date().toISOString() }) + "\n");
    }
    send({ type: "system", subtype: "init", session_id: scenario === "wrong-id" ? "other" : sessionId, cwd: process.cwd(), model,
      permissionMode: permissions, effort, tools: [], mcp_servers: [], slash_commands: [], skills: [], plugins: [], uuid: randomUUID() });
    if (scenario === "wait" || scenario === "wrong-id") return;
    const typed = typeof message.message.content === "string" ? message.message.content : "";
    if (typed === "/clear") { send({ type: "conversation_reset", session_id: sessionId, uuid: randomUUID(), new_conversation_id: randomUUID(), trigger: "clear" }); result({ user_message_uuid: user.uuid }); return; }
    if (typed.startsWith("/compact")) {
      send({ type: "system", subtype: "compact_boundary", session_id: sessionId, uuid: randomUUID(), compact_metadata: { trigger: "manual", pre_tokens: 1235, ...(typed === "/compact" ? { post_tokens: 300 } : {}) } });
      result({ user_message_uuid: user.uuid }); return;
    }
    if (scenario === "signed-out") {
      send({ type: "assistant", session_id: sessionId, parent_tool_use_id: null, uuid: randomUUID(), error: "authentication_failed", message: { id: "auth", role: "assistant", model, content: [{ type: "text", text: "Invalid API key · Please run /login" }] } });
      result({ user_message_uuid: user.uuid, is_error: true, result: "Invalid API key · Please run /login" }); return;
    }
    if (scenario === "background") {
      // A background task's bookkeeping result lands inside the user's turn and must not end it.
      result({ origin: { kind: "task-notification" }, num_turns: 0 });
      finish();
      send({ type: "system", subtype: "task_notification", session_id: sessionId, uuid: randomUUID(), task_id: "build", status: "completed", output_file: "/tmp/build.log", summary: "Build finished" });
      send({ type: "assistant", session_id: sessionId, parent_tool_use_id: null, uuid: randomUUID(), message: { id: "wake", role: "assistant", model,
        content: [{ type: "text", text: "The build finished; checking its log." }, { type: "tool_use", id: "wake-tool", name: "Bash", input: { command: "cat build.log" } }] } });
      wakeRequest = randomUUID();
      send({ type: "control_request", request_id: wakeRequest, request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "cat build.log" }, tool_use_id: "wake-tool" } });
      return;
    }
    if (scenario === "exit") { process.exit(1); return; }
    if (permissions === "plan") {
      request = randomUUID(); planning = true;
      send({ type: "assistant", session_id: sessionId, parent_tool_use_id: null, uuid: randomUUID(), message: { id: "plan", role: "assistant", model,
        content: [{ type: "tool_use", id: "exit-plan", name: "ExitPlanMode", input: { plan: "1. Read the code\n2. Change it" } }] } });
      send({ type: "control_request", request_id: request, request: { subtype: "can_use_tool", tool_name: "ExitPlanMode", input: { plan: "1. Read the code\n2. Change it" }, tool_use_id: "exit-plan" } });
    } else if (scenario === "approval") {
      request = randomUUID();
      send({ type: "control_request", request_id: request, request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "pwd" }, tool_use_id: "tool" } });
    } else if (scenario === "work") {
      send({ type: "assistant", session_id: sessionId, parent_tool_use_id: null, uuid: randomUUID(), message: { id: "tool-call", role: "assistant", model,
        content: [{ type: "tool_use", id: "bash", name: "Bash", input: { command: "pnpm build" } }] } });
      send({ type: "user", session_id: sessionId, parent_tool_use_id: null, uuid: randomUUID(), message: { role: "user",
        content: [{ type: "tool_result", tool_use_id: "bash", is_error: true, content: "Exit code 2\nerror: build failed" }] } });
      send({ type: "system", subtype: "compact_boundary", session_id: sessionId, uuid: randomUUID(), compact_metadata: { trigger: "auto", pre_tokens: 180000, post_tokens: 20000 } });
      finish();
    } else finish(scenario === "fail");
  } else if (message.type === "control_response" && message.response.request_id === wakeRequest) {
    log({ wakeAnswer: message.response.response });
    result({ origin: { kind: "task-notification" }, num_turns: 2, result: "The build log is clean." });
  } else if (message.type === "control_response" && message.response.request_id === request && planning) {
    planning = false;
    log({ planAnswer: message.response.response });
    send({ type: "result", subtype: "error_during_execution", session_id: sessionId, uuid: randomUUID(), user_message_uuid: user.uuid, is_error: true, errors: ["Interrupted"],
      stop_reason: null, duration_ms: 10, duration_api_ms: 5, num_turns: 1, total_cost_usd: 0,
      usage: { input_tokens: 4, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: {}, permission_denials: [] });
  } else if (message.type === "control_response" && message.response.request_id === request) {
    finish(message.response.response?.behavior !== "allow");
  }
});
