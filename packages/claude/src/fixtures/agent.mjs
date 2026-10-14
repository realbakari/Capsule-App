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
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const respond = (message, response = {}) => send({ type: "control_response", response: { subtype: "success", request_id: message.request_id, response } });
const failure = (message, error) => send({ type: "control_response", response: { subtype: "error", request_id: message.request_id, error } });
const log = (event) => { if (process.env.CAPSULE_CLAUDE_TEST_LOG) appendFileSync(process.env.CAPSULE_CLAUDE_TEST_LOG, JSON.stringify(event) + "\n"); };
log({ args: process.argv.slice(3) });
const finish = (is_error = false) => {
  const result = JSON.stringify({ model, effort, permissions });
  send({ type: "assistant", session_id: sessionId, parent_tool_use_id: null, uuid: randomUUID(), message: { id: "answer", role: "assistant", content: [{ type: "text", text: result }] } });
  send({ type: "result", subtype: "success", session_id: sessionId, uuid: randomUUID(), user_message_uuid: user.uuid, is_error,
    result, stop_reason: "end_turn", duration_ms: 10, duration_api_ms: 5, num_turns: 1, total_cost_usd: 0,
    usage: { input_tokens: 4, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: {}, permission_denials: [] });
};
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
    if (scenario === "exit") { process.exit(1); return; }
    if (scenario === "approval") {
      request = randomUUID();
      send({ type: "control_request", request_id: request, request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "pwd" }, tool_use_id: "tool" } });
    } else finish(scenario === "fail");
  } else if (message.type === "control_response" && message.response.request_id === request) {
    finish(message.response.response?.behavior !== "allow");
  }
});
