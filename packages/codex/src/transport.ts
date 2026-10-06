import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { spawnCommand, stopChild } from "@capsule/process";
import type { DirectAcpOptions } from "@capsule/acp";

export const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const FRAME_LIMIT = 4 * 1024 * 1024;

/** An explicit server rejection, distinct from an uncertain transport failure. */
export class CodexRequestError extends Error {}

/** One owned stdio connection. Requests are never retried after an uncertain write. */
export class CodexTransport {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private ended = false;
  private pipesClosed = false;
  private closing?: Promise<void>;
  private closed!: () => void;
  private readonly exited = new Promise<void>((resolve) => { this.closed = resolve; });

  constructor(private readonly options: DirectAcpOptions,
    private readonly receive: (message: Record<string, unknown>) => void,
    private readonly onExit: (error: Error, code: number | null) => void) {}

  get running() { return Boolean(this.child) && !this.ended; }

  start(): void {
    if (this.child || this.ended) throw new Error("This agent connection cannot be started again.");
    const child = spawnCommand(this.options.command, this.options.args, {
      cwd: this.options.cwd, env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32",
    }) as ChildProcessWithoutNullStreams;
    this.child = child;
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const frame = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!frame.trim()) continue;
        try {
          if (Buffer.byteLength(frame) > FRAME_LIMIT) throw new Error("Frame too large");
          const message = object(JSON.parse(frame));
          if (!Object.keys(message).length) throw new Error("Invalid frame");
          if (typeof message.method === "string") this.receive(message);
          else if (typeof message.id === "number") {
            const request = this.pending.get(message.id);
            if (!request) continue;
            this.pending.delete(message.id); clearTimeout(request.timer);
            if (message.error) {
              const error = object(message.error);
              request.reject(new CodexRequestError(typeof error.message === "string" ? error.message.slice(0, 2000) : "The agent rejected the request."));
            } else request.resolve(message.result);
          }
        } catch {
          this.fail(new Error("The agent returned an invalid or oversized app-server message."), null);
          void this.close().catch(() => undefined); return;
        }
      }
      if (Buffer.byteLength(buffer) > FRAME_LIMIT) {
        buffer = "";
        this.fail(new Error("The agent exceeded the app-server message limit."), null);
        void this.close().catch(() => undefined);
      }
    });
    // Drain without retaining output that may contain credentials or terminal escapes.
    child.stderr.resume();
    child.on("error", () => {
      this.fail(new Error("Could not start Codex. Make the codex CLI available on PATH and check its installation."), null);
    });
    child.stdin.on("error", () => {
      this.fail(new Error("The agent connection was lost."), null); void this.close().catch(() => undefined);
    });
    child.on("exit", (code) => this.fail(new Error("Codex stopped before the session finished. Check its version and sign-in."), code));
    child.on("close", () => { this.pipesClosed = true; this.closed(); });
  }

  send(message: Record<string, unknown>): void {
    if (!this.running || !this.child) throw new Error("The agent connection is closed.");
    const frame = JSON.stringify(message) + "\n";
    if (Buffer.byteLength(frame) > FRAME_LIMIT) throw new Error("This message exceeds the agent connection limit.");
    this.child.stdin.write(frame);
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.pending.size >= 64) return Promise.reject(new Error("Too many pending agent requests."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`Codex did not answer ${method}. Check its version and sign-in before retrying.`);
        this.fail(error, null); void this.close().catch(() => undefined);
      }, this.options.timeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) {
        clearTimeout(timer); this.pending.delete(id);
        reject(error);
      }
    });
  }

  private fail(error: Error, code: number | null): void {
    if (this.ended) return;
    this.ended = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear(); this.onExit(error, code);
  }

  close(): Promise<void> {
    return this.closing ??= (async () => {
      const child = this.child;
      if (!child) return;
      this.fail(new Error("The agent session was closed."), null);
      child.stdin.end(); stopChild(child, "SIGTERM", true);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, 500); })]);
        if (!this.pipesClosed) {
          stopChild(child, "SIGKILL", true);
          clearTimeout(timer);
          await Promise.race([this.exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, 3000); })]);
          if (!this.pipesClosed) throw new Error("The agent has not confirmed process exit. Check its running tools before restarting it.");
        }
      } finally {
        clearTimeout(timer); child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
      }
    })();
  }
}
