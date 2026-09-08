import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";

import type { AcpModelCatalog, DelegationDetails, ApprovalToolDetails, AgentCapabilityReport, ReportedContextUsage, ReportedTurnUsage, AgentPromptBlock } from "@capsule/shared";
import { TextBudget, readAgentCapabilities, readReportedTurnUsage } from "@capsule/shared";
import { readCliError } from "./errors.js";
import {
  ACP_PROTOCOL_VERSION,
  chooseOption,
  encodeMessage,
  parseMessage,
  readPermissionRequest,
  readSessionUpdate,
  readStopReason,
  type JsonRpcMessage,
  readModelCatalog,
} from "./protocol.js";

/*
 * One coding agent, spoken to directly.
 *
 * Capsule's usual route to a CLI is OpenClaw's ACP bridge. This is the same
 * protocol without the bridge: Capsule spawns the CLI itself and talks to it
 * over its own stdin and stdout. The CLI keeps the coding loop; Capsule keeps
 * the workspace. What changes is only who carries the messages.
 */

export interface DirectAcpEvents {
  configuration: () => void;
  usage: (payload: { context?: ReportedContextUsage; turn?: ReportedTurnUsage }) => void;
  /** Assistant text as it arrives. */
  text: (payload: { text: string; thought: boolean }) => void;
  /** Finish the current prose segment, not the turn or the coding session. */
  "message-end": () => void;
  /** A tool the agent is running, for the work log. */
  tool: (payload: { title: string; status?: string; toolCallId?: string; delegation?: DelegationDetails }) => void;
  /** The turn finished, with the agent's own reason. */
  done: (payload: { stopReason?: string }) => void;
  /** The agent wants permission and is blocked until it is answered. */
  permission: (payload: {
    title: string;
    details?: ApprovalToolDetails;
    canApproveOnce?: boolean;
    allow: () => void;
    deny: () => void;
    /** End an unanswered request without recording a user decision. */
    cancel: () => void;
  }) => void;
  /** The process ended. */
  exit: (payload: { code: number | null; stderr: string }) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_ACP_FRAME_BYTES = 4 * 1024 * 1024;

export interface DirectAcpOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** How long to wait for a reply to a request. A prompt is exempt. */
  timeoutMs?: number;
  /*
   * MCP servers to offer the agent when the session opens.
   *
   * These optional HTTP tools are forwarded only if the installed agent
   * advertises HTTP MCP support during initialization.
   */
  mcpServers?: AcpMcpServer[];
}

/** An HTTP MCP server, in the shape `session/new` takes. */
export interface AcpMcpServer {
  type: "http";
  name: string;
  url: string;
  headers?: Array<{ name: string; value: string }>;
}

export class DirectAcpSession {
  private readonly emitter = new EventEmitter();
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly lineBuffer = new TextBudget(MAX_ACP_FRAME_BYTES, MAX_ACP_FRAME_BYTES, 1);
  private readonly decoder = new StringDecoder("utf8");
  private stderr = "";
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }
  >();
  private acpSessionId: string | undefined;
  private acpModels: AcpModelCatalog | undefined;
  private legacyModels: AcpModelCatalog | undefined;
  private initialization: unknown;
  private capabilityReport?: AgentCapabilityReport;
  private contextReport?: ReportedContextUsage;
  private closed = false;
  private turn: Promise<unknown> | undefined;
  private cancelling = false;
  private restoring = false;
  private setting = false;
  private configurationRevision = 0;
  private configurationNotice?: ReturnType<typeof setTimeout>;
  private hasMessageText = false;
  private messageId: string | undefined;
  private readonly permissions = new Map<number | string, () => void>();
  private readonly toolTitles = new Map<string, string>();

  get busy(): boolean { return Boolean(this.turn); }
  get reportedCapabilities(): AgentCapabilityReport | undefined { return this.capabilityReport; }
  get reportedContext(): ReportedContextUsage | undefined { return this.contextReport; }

  constructor(private readonly options: DirectAcpOptions) {}

  on<K extends keyof DirectAcpEvents>(event: K, handler: DirectAcpEvents[K]): () => void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
    return () => this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  /** The agent's own id for this conversation, once it has one. */
  get sessionId(): string | undefined {
    return this.acpSessionId;
  }

  /**
   * The models this agent will run, as it named them when the session opened.
   *
   * `session/new` answers with them — grok replies with grok-4.6 and grok-4.5
   * and says which is current — and this used to read the session id out of
   * that reply and throw the rest away, so direct mode had no model list while
   * the answer was sitting in the response.
   */
  get models(): AcpModelCatalog | undefined {
    return this.acpModels;
  }

  get running(): boolean {
    return Boolean(this.child) && !this.closed;
  }

  /**
   * Start the agent and open a conversation in `cwd`.
   *
   * Returns the agent's session id. Anything that goes wrong here — the binary
   * missing, a handshake it will not complete, an account it will not serve —
   * throws before a turn is ever sent, so the failure names itself instead of
   * arriving mid-answer.
   */
  async start(resumeSessionId?: string): Promise<string> {
    if (this.child) throw new Error("This session is already running.");
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.child = child;

    child.stdout.on("data", (chunk: Buffer) => this.absorb(this.decoder.write(chunk)));
    child.stderr.on("data", (chunk: Buffer) => {
      // Kept for the error message, capped so a chatty agent cannot grow it
      // without bound over a long session.
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4000);
    });
    child.on("error", (error) => this.fail(error));
    child.on("close", (code) => {
      this.closed = true;
      this.lineBuffer.clear();
      this.toolTitles.clear();
      if (this.child === child) this.child = undefined;
      this.permissions.clear();
      for (const [, entry] of this.pending) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(new Error(this.exitReason(code)));
      }
      this.pending.clear();
      this.emitter.emit("exit", { code, stderr: this.stderr.trim() });
    });

    this.initialization = await this.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    const version = (this.initialization as { protocolVersion?: unknown } | null)?.protocolVersion;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
      throw new Error("The agent returned an invalid ACP protocol version during initialization.");
    }
    if (version !== ACP_PROTOCOL_VERSION) {
      throw new Error(`The agent selected ACP protocol version ${version}, but Capsule supports version ${ACP_PROTOCOL_VERSION}. Use a compatible agent version or update Capsule.`);
    }
    const capabilities = readAgentCapabilities(this.initialization);
    const setup = {
      cwd: this.options.cwd ?? process.cwd(),
      mcpServers: capabilities.httpMcp === true
        ? (this.options.mcpServers ?? []).map((server) => ({ ...server, headers: server.headers ?? [] }))
        : [],
    };
    let created: unknown;
    if (resumeSessionId) {
      if (resumeSessionId.length > 4096) throw new Error("Saved ACP session identity is invalid.");
      const method = capabilities.resumeSession ? "session/resume" : capabilities.loadSession ? "session/load" : undefined;
      if (!method) throw new Error("This agent cannot resume the saved session. Start a new conversation to begin a fresh agent session; the recorded history is unchanged.");
      this.acpSessionId = resumeSessionId;
      this.restoring = true;
      // Capsule already owns its transcript. Loading must not replay old tools,
      // approvals or messages as activity belonging to the new turn.
      try { created = await this.request(method, { ...setup, sessionId: resumeSessionId }); }
      finally { this.restoring = false; }
    } else created = await this.request("session/new", setup);
    const sessionId = resumeSessionId ?? (created as { sessionId?: unknown })?.sessionId;
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 4096) {
      throw new Error("The agent started but did not open a session.");
    }
    this.acpSessionId = sessionId;
    this.legacyModels = readModelCatalog((created as { models?: unknown })?.models);
    const configuration = (created as { configOptions?: unknown })?.configOptions;
    if (!this.capabilityReport || Array.isArray(configuration)) this.readConfiguration(configuration);
    // Retain only normalized metadata, not the unbounded handshake response.
    this.initialization = { agentInfo: { name: this.capabilityReport?.name, version: this.capabilityReport?.version },
      agentCapabilities: { promptCapabilities: { image: this.capabilityReport?.images, embeddedContext: this.capabilityReport?.embeddedContext },
        mcpCapabilities: { http: this.capabilityReport?.httpMcp }, loadSession: this.capabilityReport?.loadSession,
        sessionCapabilities: { ...(capabilities.resumeSession ? { resume: {} } : {}), ...(capabilities.closeSession ? { close: {} } : {}) } } };
    return sessionId;
  }

  /**
   * Send a turn and wait for the agent to finish it.
   *
   * No timeout: a turn takes as long as the work takes, and cutting one off
   * because it passed a clock would be the app inventing a failure.
   */
  async prompt(text: string | AgentPromptBlock[]): Promise<{ stopReason?: string }> {
    if (!this.acpSessionId) throw new Error("This session has not started.");
    if (this.turn) throw new Error("This agent already has an active turn. Stop it or wait before sending another message.");
    const blocks: AgentPromptBlock[] = typeof text === "string" ? [{ type: "text", text }] : text;
    for (const block of blocks) {
      if (block.type === "image" && this.capabilityReport?.images !== true) throw new Error("This agent did not advertise image prompts. Remove the image or choose a compatible agent.");
      if (block.type === "resource" && this.capabilityReport?.embeddedContext !== true) throw new Error("This agent did not advertise embedded resources. Remove the attachment or choose a compatible agent.");
    }
    if (Buffer.byteLength(JSON.stringify(blocks)) > MAX_ACP_FRAME_BYTES - 8192) throw new Error("The direct prompt exceeds the 4 MB wire budget. Use smaller attachments or less text.");
    this.cancelling = false;
    this.toolTitles.clear();
    const turn = this.request(
      "session/prompt",
      { sessionId: this.acpSessionId, prompt: blocks },
      { timeoutMs: 0 },
    );
    this.turn = turn;
    try {
      const result = await turn;
      const stopReason = readStopReason(result);
      const usage = readReportedTurnUsage((result as { usage?: unknown })?.usage);
      if (usage) this.emitter.emit("usage", { turn: usage });
      this.emitter.emit("done", { stopReason });
      return { stopReason };
    } finally {
      this.endMessage();
      this.cancelPermissions();
      if (this.turn === turn) {
        this.turn = undefined;
        this.cancelling = false;
      }
    }
  }

  /** Use exact reported IDs and accept only the agent's acknowledged state. */
  async setConfig(configId: string, value: string | boolean): Promise<void> {
    if (!this.acpSessionId || !this.running) throw new Error("Start this agent before changing its settings.");
    if (this.setting) throw new Error("Another agent setting is still being applied. Wait and try again.");
    const option = this.capabilityReport?.configOptions.find((item) => item.id === configId);
    if (!option) throw new Error("This agent no longer reports that setting. Refresh its status.");
    if (option.type === "boolean" ? typeof value !== "boolean" : typeof value !== "string" || !option.choices.some((item) => item.value === value)) {
      throw new Error("Choose one of the values reported by this agent.");
    }
    this.setting = true;
    const revision = this.configurationRevision;
    try {
      const response = await this.request("session/set_config_option", { sessionId: this.acpSessionId, configId, value,
        ...(option.type === "boolean" ? { type: "boolean" } : {}) });
      const options = (response as { configOptions?: unknown } | null)?.configOptions;
      if (!Array.isArray(options)) throw new Error("The agent did not return its configuration after the change. Refresh status before retrying.");
      // A notification delivered during the request is newer authoritative
      // state. Do not let a delayed response restore old dependent options.
      if (revision === this.configurationRevision) this.readConfiguration(options);
      const confirmed = this.capabilityReport?.configOptions.find((item) => item.id === configId);
      if ((confirmed?.type === "boolean" ? confirmed.booleanValue : confirmed?.currentValue) !== value) {
        throw new Error("The agent reports a different value. Its reported setting has been retained.");
      }
    } finally { this.setting = false; }
  }

  /** Ask the agent to stop the turn it is on. */
  async cancel(): Promise<void> {
    if (!this.acpSessionId || !this.child) return;
    this.cancelling = true;
    this.cancelPermissions();
    this.notify("session/cancel", { sessionId: this.acpSessionId });
    const turn = this.turn;
    if (!turn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        turn.then(() => undefined, () => undefined),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("The agent has not confirmed cancellation. It may still be working; close the agent to stop its process.")), DEFAULT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** End the conversation and the process with it. */
  async close(): Promise<void> {
    clearTimeout(this.configurationNotice);
    this.configurationNotice = undefined;
    this.cancelPermissions();
    this.closed = true;
    const child = this.child;
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      // Already gone; the kill below is what matters.
    }
    await new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => child.kill("SIGKILL"), 3000);
      const timeout = setTimeout(() => {
        clearTimeout(force);
        reject(new Error("The agent process has not exited. It may still be working."));
      }, 10_000);
      child.once("close", () => { clearTimeout(force); clearTimeout(timeout); resolve(); });
      child.kill();
    });
  }

  private exitReason(code: number | null): string {
    /*
     * The line that says what went wrong, not the last line printed. Taking
     * the last one surfaced a CLI's usage footer as the failure: a thread
     * whose only explanation was "For more information, try '--help'."
     */
    const detail = readCliError(this.stderr);
    if (detail) return detail;
    return code === null
      ? `${this.options.command} stopped before answering.`
      : `${this.options.command} exited with code ${code}.`;
  }

  private fail(error: Error): void {
    for (const [, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private absorb(chunk: string): void {
    if (this.closed) return;
    try {
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf("\n", offset);
        const end = newline < 0 ? chunk.length : newline;
        this.lineBuffer.append("line", chunk.slice(offset, end));
        if (newline < 0) break;
        const message = parseMessage(this.lineBuffer.take("line"));
        if (message) this.handle(message);
        offset = newline + 1;
      }
    } catch (error) {
      this.lineBuffer.clear();
      this.fail(new Error(`Invalid or oversized ACP frame: ${String(error)}`));
      // Only close the child this session spawned. A protocol failure must not
      // leave an unbounded producer running after its pending turn has failed.
      void this.close().catch(() => undefined);
    }
  }

  private handle(message: JsonRpcMessage): void {
    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      const entry = this.pending.get(message.id as number);
      if (!entry) return;
      this.pending.delete(message.id as number);
      if (entry.timer) clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }

    if (message.method === "session/update") {
      const update = readSessionUpdate(message.params);
      if (!update || (update.sessionId && update.sessionId !== this.acpSessionId)) return;
      if (this.restoring) {
        if (update.configOptions) this.readConfiguration(update.configOptions);
        return;
      }
      // Prefer the agent's message identity. Older agents omit it, so new
      // tools remain a fallback boundary. Background status updates never
      // split a streamed word or code block.
      if ((update.startsTool && this.messageId === undefined) || (update.thought && update.text)) this.endMessage();
      if (update.sessionId === this.acpSessionId) {
        if (update.configOptions) this.readConfiguration(update.configOptions);
        if (update.contextUsage && JSON.stringify(update.contextUsage) !== JSON.stringify(this.contextReport)) {
          this.contextReport = update.contextUsage;
          this.emitter.emit("usage", { context: update.contextUsage });
        }
      }
      if (update.text !== undefined) {
        if (!update.thought) {
          if (update.messageId !== undefined && update.messageId !== this.messageId) this.endMessage();
          if (update.messageId !== undefined) this.messageId = update.messageId;
          if (update.text) this.hasMessageText = true;
        }
        this.emitter.emit("text", { text: update.text, thought: Boolean(update.thought) });
      }
      if (update.tool) {
        const { toolCallId, title } = update.tool;
        if (toolCallId && title) {
          this.toolTitles.set(toolCallId, title);
          while (this.toolTitles.size > 1000) this.toolTitles.delete(this.toolTitles.keys().next().value!);
        }
        this.emitter.emit("tool", {
          ...update.tool,
          title: title || (toolCallId && this.toolTitles.get(toolCallId)) || "Run a tool",
        });
      }
      return;
    }

    if (message.method === "session/request_permission" && message.id !== undefined) {
      const request = readPermissionRequest(message.params);
      if (!request || this.closed || this.cancelling || this.restoring || (request.sessionId && request.sessionId !== this.acpSessionId)) {
        // An agent waits on this reply. Something we cannot read has to be
        // answered anyway, or the turn stops here for good.
        this.respond(message.id, { outcome: { outcome: "cancelled" } });
        return;
      }
      let settled = false;
      const answer = (decision: "allow" | "deny" | "cancel") => {
        // A callback from a finished request must not settle a newer request
        // even if the agent later reuses that JSON-RPC ID.
        if (settled) return;
        settled = true;
        this.permissions.delete(message.id!);
        const optionId = decision === "cancel" ? undefined : chooseOption(request.options, decision);
        this.respond(message.id!, { outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" } });
      };
      this.endMessage();
      this.permissions.set(message.id, () => answer("cancel"));
      const handled = this.emitter.emit("permission", {
        title: request.title,
        details: request.details,
        canApproveOnce: request.details.canApproveOnce,
        allow: () => answer("allow"),
        deny: () => answer("deny"),
        cancel: () => answer("cancel"),
      });
      if (!handled) answer("cancel");
      return;
    }

    /*
     * Anything else the agent asks of us — reading a file, writing one — is
     * declined rather than ignored: Capsule did not offer those capabilities
     * in `initialize`, and an unanswered request is a hung turn.
     */
    if (message.method && message.id !== undefined) {
      this.respondError(message.id, `Capsule does not provide ${message.method}.`);
    }
  }

  private endMessage(): void {
    this.messageId = undefined;
    // Reasoning may contain thousands of chunks. Only the first transition
    // after prose needs a flush; empty boundaries must not read history again.
    if (!this.hasMessageText) return;
    this.hasMessageText = false;
    this.emitter.emit("message-end");
  }

  private readConfiguration(options: unknown): void {
    this.configurationRevision++;
    this.capabilityReport = readAgentCapabilities(this.initialization, options);
    const model = this.capabilityReport.configOptions.find((option) => option.type !== "boolean" && (option.id === "model" || option.category === "model"));
    // Config notifications replace the entire snapshot, including removals.
    // Only a catalog actually supplied by the legacy API is a valid fallback.
    this.acpModels = model ? {
      currentModelId: model.currentValue,
      availableModels: model.choices.map((choice) => ({ modelId: choice.value, name: choice.name })),
    } : this.legacyModels;
    // Status consumers need the latest snapshot, not one IPC refresh per frame.
    if (!this.restoring && !this.configurationNotice) {
      this.configurationNotice = setTimeout(() => {
        this.configurationNotice = undefined;
        if (this.running) this.emitter.emit("configuration");
      }, 250);
      this.configurationNotice.unref();
    }
  }

  private cancelPermissions(): void {
    for (const cancel of this.permissions.values()) cancel();
  }

  private request(
    method: string,
    params: unknown,
    options?: { timeoutMs?: number },
  ): Promise<unknown> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("This session is not running."));
    const id = this.nextId++;
    const timeoutMs = options?.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`${this.options.command} did not answer ${method} in time.`));
            }, timeoutMs)
          : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(encodeMessage({ jsonrpc: "2.0", id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    try {
      this.child?.stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }));
    } catch {
      // A notification that cannot be written is a process already gone; the
      // close handler is what reports that.
    }
  }

  private respond(id: number | string, result: unknown): void {
    try {
      this.child?.stdin.write(encodeMessage({ jsonrpc: "2.0", id, result }));
    } catch {
      // Same as notify: the process is gone and close() will say so.
    }
  }

  private respondError(id: number | string, message: string): void {
    try {
      this.child?.stdin.write(
        encodeMessage({ jsonrpc: "2.0", id, error: { code: -32601, message } }),
      );
    } catch {
      // Same as notify.
    }
  }
}
