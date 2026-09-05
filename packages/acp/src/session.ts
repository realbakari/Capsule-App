import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

import type { AcpModelCatalog } from "@capsule/shared";
import { readCliError } from "./errors.js";
import {
  ACP_PROTOCOL_VERSION,
  chooseOption,
  encodeMessage,
  parseMessage,
  readPermissionRequest,
  readSessionUpdate,
  readStopReason,
  splitLines,
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
  /** Assistant text as it arrives. */
  text: (payload: { text: string; thought: boolean }) => void;
  /** A tool the agent is running, for the work log. */
  tool: (payload: { title: string; status?: string; toolCallId?: string }) => void;
  /** The turn finished, with the agent's own reason. */
  done: (payload: { stopReason?: string }) => void;
  /** The agent wants permission and is blocked until it is answered. */
  permission: (payload: {
    title: string;
    allow: () => void;
    deny: () => void;
  }) => void;
  /** The process ended. */
  exit: (payload: { code: number | null; stderr: string }) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

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
   * Both agents Capsule spawns report `mcpCapabilities: {http: true}`, so
   * these are HTTP entries rather than child processes. Sent as given: the
   * caller knows what it is running and what it will let the agent reach.
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
  private buffered = "";
  private stderr = "";
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }
  >();
  private acpSessionId: string | undefined;
  private acpModels: AcpModelCatalog | undefined;
  private closed = false;
  private turn: Promise<unknown> | undefined;
  private readonly permissions = new Map<number | string, () => void>();
  private readonly toolTitles = new Map<string, string>();

  get busy(): boolean { return Boolean(this.turn); }

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
  async start(): Promise<string> {
    if (this.child) throw new Error("This session is already running.");
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.child = child;

    child.stdout.on("data", (chunk: Buffer) => this.absorb(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => {
      // Kept for the error message, capped so a chatty agent cannot grow it
      // without bound over a long session.
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4000);
    });
    child.on("error", (error) => this.fail(error));
    child.on("close", (code) => {
      this.closed = true;
      if (this.child === child) this.child = undefined;
      this.permissions.clear();
      for (const [, entry] of this.pending) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(new Error(this.exitReason(code)));
      }
      this.pending.clear();
      this.emitter.emit("exit", { code, stderr: this.stderr.trim() });
    });

    await this.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });

    const created = await this.request("session/new", {
      cwd: this.options.cwd ?? process.cwd(),
      mcpServers: this.options.mcpServers ?? [],
    });
    const sessionId = (created as { sessionId?: unknown })?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) {
      throw new Error("The agent started but did not open a session.");
    }
    this.acpSessionId = sessionId;
    this.acpModels = readModelCatalog((created as { models?: unknown })?.models);
    return sessionId;
  }

  /**
   * Send a turn and wait for the agent to finish it.
   *
   * No timeout: a turn takes as long as the work takes, and cutting one off
   * because it passed a clock would be the app inventing a failure.
   */
  async prompt(text: string): Promise<{ stopReason?: string }> {
    if (!this.acpSessionId) throw new Error("This session has not started.");
    if (this.turn) throw new Error("This agent already has an active turn. Stop it or wait before sending another message.");
    this.toolTitles.clear();
    const turn = this.request(
      "session/prompt",
      { sessionId: this.acpSessionId, prompt: [{ type: "text", text }] },
      { timeoutMs: 0 },
    );
    this.turn = turn;
    try {
      const stopReason = readStopReason(await turn);
      this.emitter.emit("done", { stopReason });
      return { stopReason };
    } finally {
      if (this.turn === turn) this.turn = undefined;
      this.cancelPermissions();
    }
  }

  /** Ask the agent to stop the turn it is on. */
  async cancel(): Promise<void> {
    if (!this.acpSessionId || !this.child) return;
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
    const { lines, rest } = splitLines(`${this.buffered}${chunk}`);
    this.buffered = rest;
    for (const line of lines) {
      const message = parseMessage(line);
      if (message) this.handle(message);
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
      if (update.text !== undefined) {
        this.emitter.emit("text", { text: update.text, thought: Boolean(update.thought) });
      }
      if (update.tool) {
        const { toolCallId, title } = update.tool;
        if (toolCallId && title) this.toolTitles.set(toolCallId, title);
        this.emitter.emit("tool", {
          ...update.tool,
          title: title || (toolCallId && this.toolTitles.get(toolCallId)) || "Run a tool",
        });
      }
      return;
    }

    if (message.method === "session/request_permission" && message.id !== undefined) {
      const request = readPermissionRequest(message.params);
      if (!request || (request.sessionId && request.sessionId !== this.acpSessionId)) {
        // An agent waits on this reply. Something we cannot read has to be
        // answered anyway, or the turn stops here for good.
        this.respond(message.id, { outcome: { outcome: "cancelled" } });
        return;
      }
      const answer = (decision: "allow" | "deny") => {
        if (!this.permissions.delete(message.id!)) return;
        const optionId = chooseOption(request.options, decision);
        this.respond(message.id!, { outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" } });
      };
      this.permissions.set(message.id, () => answer("deny"));
      const handled = this.emitter.emit("permission", {
        title: request.title,
        allow: () => answer("allow"),
        deny: () => answer("deny"),
      });
      if (!handled) answer("deny");
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

  private cancelPermissions(): void {
    for (const deny of this.permissions.values()) deny();
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
