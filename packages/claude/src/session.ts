import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { realpathSync } from "node:fs";
import { query, getSessionInfo, type Query, type ModelInfo, type SDKMessage, type SDKUserMessage, type CanUseTool, type PermissionResult, type PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { spawnCommand, stopChild } from "@capsule/process";
import type { DirectAcpEvents, DirectAcpOptions, DirectAgentSession } from "@capsule/acp";
import { readPlanEntries, readReportedTurnUsage, readToolActivityDetails, type AcpModelCatalog, type AgentCapabilityReport, type AgentCommand, type AgentPromptBlock, type ReportedContextUsage } from "@capsule/shared";
import { ClaudeInput } from "./input.js";
import { isClaudeEffort, isClaudePermission, permissionChoices } from "./configuration.js";

type Turn = {
  uuid: string; resolve(value: { stopReason?: string }): void; reject(error: Error): void;
  finished: Promise<void>; settle(): void; cancelling: boolean; hasText: boolean;
};

/** The SDK owns the protocol; the installed CLI owns authentication, tools and execution. */
export class DirectClaudeSession implements DirectAgentSession {
  private readonly emitter = new EventEmitter();
  private readonly input = new ClaudeInput();
  private connection?: Query;
  private child?: ChildProcess;
  private exited?: Promise<void>;
  private reading?: Promise<void>;
  private closing?: Promise<void>;
  private cancelling?: Promise<void>;
  private closed = false;
  private ready = false;
  private nativeId?: string;
  private version?: string;
  private modelRows: ModelInfo[] = [];
  private selectedModel?: string;
  private effort?: string;
  private permissions: PermissionMode = "default";
  private commands?: AgentCommand[];
  private context?: ReportedContextUsage;
  private turn?: Turn;
  private setting = false;
  private stderr = "";
  private readonly approvals = new Set<() => void>();
  private readonly streamed = new Set<string>();
  private streamId?: string;
  private readonly tools = new Map<string, string>();

  constructor(private readonly options: DirectAcpOptions & { model?: string }) { this.selectedModel = options.model; }
  on<K extends keyof DirectAcpEvents>(event: K, handler: DirectAcpEvents[K]): () => void {
    this.emitter.on(event, handler); return () => { this.emitter.off(event, handler); };
  }
  get busy() { return Boolean(this.turn); }
  get running() { return this.ready && !this.closed; }
  get sessionId() { return this.nativeId; }
  get reportedCommands() { return this.commands; }
  get reportedContext() { return this.context; }
  get models(): AcpModelCatalog {
    return { currentModelId: this.selectedModel, availableModels: this.modelRows.map((row) => ({ modelId: row.value, name: row.displayName })) };
  }
  private get model() { return this.modelRows.find((row) => row.value === this.selectedModel || row.resolvedModel === this.selectedModel); }
  get reportedCapabilities(): AgentCapabilityReport {
    return { name: "Claude Code", version: this.version, images: true, embeddedContext: true, httpMcp: false, resumeSession: true,
      configOptions: [
        ...(this.modelRows.length ? [{ id: "model", category: "model", name: "Model", currentValue: this.selectedModel,
          choices: this.modelRows.map((row) => ({ value: row.value, name: row.displayName })) }] : []),
        ...(this.model?.supportsEffort && this.model.supportedEffortLevels?.length ? [{ id: "effort", category: "thought_level", name: "Reasoning effort", currentValue: this.effort,
          choices: this.model.supportedEffortLevels.map((value) => ({ value, name: value === "xhigh" ? "Extra high" : value[0]!.toUpperCase() + value.slice(1) })) }] : []),
        { id: "permissions", category: "permissions", name: "Permissions", currentValue: this.permissions, choices: permissionChoices(this.model) },
      ] };
  }

  async discover(): Promise<void> { await this.open(true); }
  async start(resumeSessionId?: string): Promise<string> {
    if (resumeSessionId) {
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(resumeSessionId)) throw new Error("The saved Claude session identifier is invalid.");
      const saved = await getSessionInfo(resumeSessionId, { dir: this.options.cwd });
      if (!saved || (saved.cwd && realpathSync(saved.cwd) !== realpathSync(this.options.cwd ?? process.cwd()))) {
        throw new Error("The saved Claude conversation was not found in this folder. Start a new conversation; its recorded history is unchanged.");
      }
    }
    this.nativeId = resumeSessionId ?? randomUUID();
    await this.open(false, resumeSessionId);
    return this.nativeId;
  }

  private async open(probe: boolean, resume?: string): Promise<void> {
    if (this.connection || this.closed) throw new Error("This agent connection cannot be started again.");
    this.connection = query({ prompt: this.input, options: {
      pathToClaudeCodeExecutable: this.options.command, cwd: this.options.cwd,
      env: { ...(this.options.env ?? process.env), ...(probe ? { ENABLE_CLAUDEAI_MCP_SERVERS: "false", CLAUDE_CODE_AUTO_CONNECT_IDE: "0" } : {}) },
      persistSession: !probe, ...(resume ? { resume } : this.nativeId ? { sessionId: this.nativeId } : {}),
      model: this.options.model, permissionMode: "default", allowDangerouslySkipPermissions: !probe,
      includePartialMessages: true, settingSources: ["user", "project", "local"],
      ...(probe ? { settings: { disableAllHooks: true }, tools: [], mcpServers: {}, strictMcpConfig: true } : {}),
      canUseTool: this.approve,
      spawnClaudeCodeProcess: (spawnOptions) => {
        const child = spawnCommand(spawnOptions.command, [...this.options.args, ...spawnOptions.args], {
          cwd: spawnOptions.cwd, env: spawnOptions.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
          detached: process.platform !== "win32",
        });
        this.child = child;
        if (!child.stdin || !child.stdout || !child.stderr) { stopChild(child, "SIGKILL", true); throw new Error("Claude's process streams are unavailable."); }
        child.stderr.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString()).slice(-8192); });
        this.exited = new Promise((resolve) => child.once("close", () => resolve()));
        child.on("error", () => { /* SDK reports spawn failures through its request/iterator. */ });
        return Object.assign(child, { stdin: child.stdin, stdout: child.stdout });
      },
    } });
    this.reading = this.read(this.connection);
    try {
      const init = await this.control(this.connection.initializationResult());
      if (!Array.isArray(init.models) || !Array.isArray(init.commands)) throw new Error("This Claude installation does not report compatible session controls. Update the Claude CLI and retry.");
      this.version = init.claude_code_version;
      this.modelRows = init.models.slice(0, 256).filter((row) => typeof row.value === "string" && row.value.length > 0 && row.value.length <= 4096)
        .map((row) => ({ ...row, displayName: row.displayName.slice(0, 128), supportedEffortLevels: row.supportedEffortLevels?.filter(isClaudeEffort).slice(0, 5) }));
      this.commands = init.commands.slice(0, 128).map((row) => ({ name: row.name, description: row.description, inputHint: row.argumentHint }));
      if (this.selectedModel && !this.model) throw new Error("The selected model is not reported by this Claude installation. Choose a reported model or its default.");
      if (this.closed) throw new Error(this.stderr || "Claude exited during initialization.");
      this.ready = true;
      this.emitter.emit("configuration");
    } catch (error) { await this.close(); throw error; }
  }

  async setConfig(configId: string, value: string | boolean): Promise<void> {
    if (!this.connection || !this.running || !this.nativeId) throw new Error("This agent session is not running.");
    if (this.busy || this.setting) throw new Error("Wait for the current operation before changing agent settings.");
    const option = this.reportedCapabilities.configOptions.find((row) => row.id === configId);
    if (!option?.choices.some((row) => row.value === value)) throw new Error("Choose a value reported by this agent.");
    this.setting = true;
    try {
      if (configId === "model" && typeof value === "string") {
        // Tighten Auto before moving to a model that cannot classify permissions.
        const next = this.modelRows.find((row) => row.value === value);
        if (this.permissions === "auto" && !next?.supportsAutoMode) {
          await this.control(this.connection.setPermissionMode("default")); this.permissions = "default";
        }
        await this.control(this.connection.setModel(value)); this.selectedModel = value; this.effort = undefined;
      } else if (configId === "effort" && isClaudeEffort(value)) {
        await this.control(this.connection.applyFlagSettings({ effortLevel: value })); this.effort = value;
      } else if (configId === "permissions" && isClaudePermission(value)) {
        await this.control(this.connection.setPermissionMode(value)); this.permissions = value;
      } else throw new Error("Unsupported agent setting.");
    } finally { this.setting = false; this.emitter.emit("configuration"); }
  }

  async prompt(input: string | AgentPromptBlock[]): Promise<{ stopReason?: string }> {
    if (!this.running || !this.nativeId) throw new Error("This agent session is not running.");
    if (this.turn || this.setting) throw new Error("This agent already has an active operation.");
    const content: SDKUserMessage["message"]["content"] = typeof input === "string" ? input : input.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      if (block.type === "resource" && "text" in block.resource) return { type: "text", text: `${block.resource.uri}\n${block.resource.text}` };
      if (block.type === "image" && (block.mimeType === "image/png" || block.mimeType === "image/jpeg" || block.mimeType === "image/gif" || block.mimeType === "image/webp")) return { type: "image", source: { type: "base64", media_type: block.mimeType, data: block.data } };
      throw new Error("This agent accepts text and PNG, JPEG, GIF or WebP images, not this attachment type.");
    });
    if (Buffer.byteLength(JSON.stringify(content)) > 4 * 1024 * 1024) throw new Error("The prompt is too large. Use smaller attachments.");
    this.streamed.clear(); this.tools.clear(); this.streamId = undefined;
    return new Promise((resolve, reject) => {
      let settle!: () => void;
      const finished = new Promise<void>((done) => { settle = done; });
      const uuid = randomUUID();
      this.turn = { uuid, resolve, reject, finished, settle, cancelling: false, hasText: false };
      try { this.input.push({ type: "user", uuid, session_id: this.nativeId, parent_tool_use_id: null, message: { role: "user", content } }); }
      catch (error) { this.finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  cancel(): Promise<void> {
    return this.cancelling ??= this.cancelTurn().finally(() => { this.cancelling = undefined; });
  }
  private async cancelTurn(): Promise<void> {
    const turn = this.turn;
    if (!turn || !this.connection) return;
    turn.cancelling = true; this.cancelApprovals();
    try { await this.control(this.connection.interrupt()); await this.control(turn.finished); }
    catch (error) { await this.close(); throw error; }
  }
  close(): Promise<void> {
    return this.closing ??= this.closeOwned().catch((error: unknown) => { this.closing = undefined; throw error; });
  }
  private async closeOwned(): Promise<void> {
    this.closed = true; this.ready = false; this.cancelApprovals(); this.input.close();
    this.finish(new Error("The Claude connection was closed."));
    this.connection?.close();
    const child = this.child;
    if (!child || !this.exited) return;
    const force = setTimeout(() => stopChild(child, "SIGKILL", true), 3000);
    try { await this.deadline(this.exited, 10_000, "Claude did not exit. Its process may still be running."); }
    finally { clearTimeout(force); }
    await this.reading;
  }
  private async deadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
    finally { clearTimeout(timer); }
  }
  private async control<T>(promise: Promise<T>): Promise<T> {
    return this.deadline(promise, this.options.timeoutMs ?? 25_000, "Claude did not confirm the operation in time.").catch((error: unknown) => {
      // An unacknowledged setting must never be followed by a prompt on ambiguous state.
      if (error instanceof Error && error.message === "Claude did not confirm the operation in time.") void this.close().catch(() => undefined);
      throw error;
    });
  }
  private finish(error?: Error, stopReason = "end_turn"): void {
    const turn = this.turn; this.turn = undefined;
    this.cancelApprovals(); this.streamed.clear(); this.tools.clear();
    if (!turn) return;
    this.emitter.emit("message-end"); turn.settle();
    if (error) turn.reject(error);
    else { this.emitter.emit("done", { stopReason }); turn.resolve({ stopReason }); }
  }
  private async read(connection: Query): Promise<void> {
    try {
      for await (const message of connection) this.receive(message);
      if (!this.closed) this.finish(new Error("Claude stopped before finishing its response."));
    } catch (error) {
      if (!this.closed) this.finish(error instanceof Error ? error : new Error(String(error)));
    } finally {
      const expected = this.closed; this.closed = true; this.ready = false;
      this.emitter.emit("exit", { code: this.child?.exitCode ?? null, stderr: expected ? "" : this.stderr || "Claude disconnected." });
      if (!expected) void this.close().catch(() => undefined);
    }
  }
  private receive(message: SDKMessage): void {
    if (this.closed) return;
    if (message.type === "system" && message.subtype === "init") {
      if ((this.nativeId && message.session_id !== this.nativeId) || realpathSync(message.cwd) !== realpathSync(this.options.cwd ?? process.cwd())) {
        this.finish(new Error("Claude opened a different session or working folder. The connection was closed.")); void this.close().catch(() => undefined); return;
      }
      this.selectedModel = this.modelRows.find((row) => row.value === message.model || row.resolvedModel === message.model)?.value ?? message.model;
      this.permissions = message.permissionMode; this.effort = message.effort ?? undefined;
      this.emitter.emit("configuration"); return;
    }
    const turn = this.turn;
    if (!turn || ("session_id" in message && message.session_id !== this.nativeId)) return;
    if ("parent_tool_use_id" in message && message.parent_tool_use_id) return;
    if (message.type === "stream_event") {
      const event = message.event;
      if (event.type === "message_start") this.streamId = event.message.id;
      if (event.type === "content_block_delta" && (event.delta.type === "text_delta" || event.delta.type === "thinking_delta")) {
        if (this.streamId && this.streamed.size < 4096) this.streamed.add(this.streamId);
        const thought = event.delta.type === "thinking_delta";
        const text = event.delta.type === "text_delta" ? event.delta.text : event.delta.thinking;
        if (!thought && text) turn.hasText = true;
        this.emitter.emit("text", { text, thought });
      }
    } else if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text" && !this.streamed.has(message.message.id)) { turn.hasText = true; this.emitter.emit("text", { text: block.text, thought: false }); }
        if (block.type === "thinking" && !this.streamed.has(message.message.id)) this.emitter.emit("text", { text: block.thinking, thought: true });
        if (block.type === "tool_use") {
          if (this.tools.size < 256) this.tools.set(block.id, block.name);
          this.emitter.emit("tool", { toolCallId: block.id, title: block.name, status: "in_progress", details: readToolActivityDetails({ rawInput: block.input }) });
          if (block.name === "TodoWrite" && block.input && typeof block.input === "object" && "todos" in block.input) {
            const entries = readPlanEntries(block.input.todos); if (entries) this.emitter.emit("plan", { entries });
          }
        }
      }
      this.emitter.emit("message-end");
    } else if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) if (block.type === "tool_result") {
        const output = typeof block.content === "string" ? block.content : block.content?.filter((row) => row.type === "text").map((row) => row.text).join("\n");
        this.emitter.emit("tool", { toolCallId: block.tool_use_id, title: this.tools.get(block.tool_use_id) ?? "Tool result", status: block.is_error ? "failed" : "completed", details: readToolActivityDetails({ rawOutput: output }) });
      }
    } else if (message.type === "result") {
      if (message.user_message_uuid && message.user_message_uuid !== turn.uuid) return;
      const usage = message.usage;
      const reported = readReportedTurnUsage({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cachedReadTokens: usage.cache_read_input_tokens, cachedWriteTokens: usage.cache_creation_input_tokens });
      this.emitter.emit("usage", { turn: reported });
      if (turn.cancelling) this.finish(undefined, "cancelled");
      else if (message.subtype !== "success" || message.is_error) this.finish(new Error(message.subtype === "success" ? message.result : message.errors.join("\n")));
      else {
        if (!turn.hasText && message.result) this.emitter.emit("text", { text: message.result, thought: false });
        this.finish(undefined, message.stop_reason === "max_tokens" ? "max_tokens" : "end_turn");
      }
    }
  }
  private cancelApprovals(): void { for (const cancel of this.approvals) cancel(); this.approvals.clear(); }
  private readonly approve: CanUseTool = (name, input, options) => {
    if (!this.turn || this.turn.cancelling || this.closed || options.signal.aborted || this.approvals.size >= 64) return Promise.resolve({ behavior: "deny", message: "No active user turn can approve this action.", interrupt: true });
    return new Promise<PermissionResult>((resolve) => {
      let answered = false;
      let settle!: () => void;
      const settled = new Promise<void>((done) => { settle = done; });
      const answer = (allow: boolean, interrupt = false) => {
        if (answered) return; answered = true; this.approvals.delete(cancel); options.signal.removeEventListener("abort", cancel); settle();
        resolve(allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "The user did not approve this action.", interrupt });
      };
      const cancel = () => answer(false, true);
      this.approvals.add(cancel); options.signal.addEventListener("abort", cancel, { once: true });
      const preview = JSON.stringify(input);
      const handled = this.emitter.emit("permission", { title: options.title ?? `Allow ${name}?`, canApproveOnce: true, settled,
        details: { toolCallId: options.toolUseID, kind: name === "Bash" ? "execute" : /Edit|Write/.test(name) ? "edit" : "other", locations: options.blockedPath ? [options.blockedPath] : [], preview: preview.slice(0, 8000), truncated: preview.length > 8000, canApproveOnce: true },
        allow: () => answer(true), deny: () => answer(false), cancel,
      });
      if (!handled) cancel();
    });
  };
}
