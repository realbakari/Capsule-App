import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { McpServerConfig, McpTestResult } from "@capsule/shared";

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT = { name: "capsule", version: "1" };
const MAX_TOOLS = 500;

/**
 * Start or reach one server, initialize, and list its tools. It runs the
 * server's command, so only a person on the desktop may ask for it.
 */
export async function probeMcpServer(config: McpServerConfig, options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<McpTestResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 10_000;
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const silent = `No answer within ${seconds} second${seconds === 1 ? "" : "s"}.`;
  try {
    const tools = "url" in config ? await probeHttp(config, timeoutMs, silent) : await probeStdio(config, options, timeoutMs, silent);
    return { ok: true, tools, durationMs: Date.now() - started };
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    return { ok: false, error: failure.message, durationMs: Date.now() - started, ...(failure.stderr ? { stderr: failure.stderr } : {}) };
  }
}

function toolNames(result: unknown): string[] {
  const tools = (result as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(tools)) throw new Error("The server answered tools/list without a tools array.");
  return tools.slice(0, MAX_TOOLS).map((tool) => String((tool as { name?: unknown }).name ?? "")).filter(Boolean);
}

function probeStdio(config: Extract<McpServerConfig, { command: string }>, options: { cwd: string; env: NodeJS.ProcessEnv }, timeoutMs: number, silent: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.command, config.args ?? [], {
      cwd: config.cwd ?? options.cwd, env: { ...options.env, ...config.env }, stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32", windowsHide: true,
    });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, tools?: string[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch { /* Already gone. */ }
      if (error) reject(Object.assign(error, { stderr: stderr.trim().slice(-2048) || undefined }));
      else resolve(tools!);
    };
    const timer = setTimeout(() => finish(new Error(silent)), timeoutMs);
    const send = (message: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    child.on("error", (error) => finish(new Error(`Could not start ${config.command}: ${error.message}`)));
    child.on("exit", (code) => finish(new Error(`The server exited (code ${code ?? "none"}) before listing its tools.`)));
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
    createInterface({ input: child.stdout }).on("line", (line) => {
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try { message = JSON.parse(line); } catch { return; }
      if (message.error && (message.id === 1 || message.id === 2)) return finish(new Error(message.error.message ?? "The server returned an error."));
      if (message.id === 1) {
        send({ method: "notifications/initialized" });
        send({ id: 2, method: "tools/list", params: {} });
      } else if (message.id === 2) {
        try { finish(undefined, toolNames(message.result)); } catch (error) { finish(error as Error); }
      }
    });
    send({ id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT } });
  });
}

async function probeHttp(config: Extract<McpServerConfig, { url: string }>, timeoutMs: number, silent: string): Promise<string[]> {
  const signal = AbortSignal.timeout(timeoutMs);
  let session: string | undefined;
  const post = async (message: object): Promise<unknown> => {
    const response = await fetch(config.url, {
      method: "POST", signal,
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...config.headers, ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", ...message }),
    }).catch((error: unknown) => {
      throw new Error(signal.aborted ? silent : `Could not reach ${config.url}: ${(error as Error).message}`);
    });
    if (!response.ok) throw new Error(`${config.url} answered ${response.status} ${response.statusText}.`);
    session = response.headers.get("mcp-session-id") ?? session;
    if (!("id" in message)) return undefined;
    const text = await response.text();
    const body = response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).find((data) => {
        try { return (JSON.parse(data) as { id?: unknown }).id === (message as { id: number }).id; } catch { return false; }
      })
      : text;
    const parsed = JSON.parse(body ?? "null") as { result?: unknown; error?: { message?: string } } | null;
    if (!parsed) throw new Error("The server's answer could not be read.");
    if (parsed.error) throw new Error(parsed.error.message ?? "The server returned an error.");
    return parsed.result;
  };
  await post({ id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT } });
  await post({ method: "notifications/initialized" });
  return toolNames(await post({ id: 2, method: "tools/list", params: {} }));
}
