import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { localTimings } from "@capsule/shared";
import { browserDiagnostics } from "./browser-diagnostics";
import {
  browserNavigate, browserSnapshot, browserStatus, browserInteract, browserScroll,
  browserPress, browserScreenshot, type BrowserTarget, type ToolResult,
} from "./browser-tools";

const PROTOCOL_VERSION = "2025-06-18";
const refProperties = {
  snapshotId: { type: "string", description: "snapshotId from the latest browser_snapshot.", maxLength: 64 },
  ref: { type: "integer", minimum: 1, maximum: 200, description: "Element ref from that snapshot." },
};
const schema = (properties: Record<string, unknown> = {}, required: string[] = []) =>
  ({ type: "object", properties, required, additionalProperties: false });

/** Each advertised action has a bounded, implemented operation; no arbitrary page JS. */
export const BROWSER_TOOLS = [
  { name: "browser_status", description: "Read the URL, title and loading state of this thread's browser.", inputSchema: schema() },
  { name: "browser_navigate", description: "Open an HTTP(S) URL in this thread's granted browser: its background page when one exists, otherwise the visible page. Enable the matching agent-control grant in Browser first.", inputSchema: schema({ url: { type: "string", maxLength: 2048 } }, ["url"]) },
  { name: "browser_snapshot", description: "Read bounded visible text and element refs. Prefer these over coordinates. Refs belong to this snapshot and become stale after navigation or a new snapshot.", inputSchema: schema() },
  { name: "browser_click", description: "Click an enabled, uncovered element from the latest snapshot. Dispatch is not proof of success; inspect afterward. Downloads are not supported.", inputSchema: schema(refProperties, ["snapshotId", "ref"]) },
  { name: "browser_type", description: "Replace a text input or textarea's contents. Does not submit. Passwords, file inputs and rich text editors require manual interaction.", inputSchema: schema({ ...refProperties, text: { type: "string", maxLength: 10000 } }, ["snapshotId", "ref", "text"]) },
  { name: "browser_select", description: "Choose an enabled option in a select element by its exact value.", inputSchema: schema({ ...refProperties, text: { type: "string", maxLength: 10000 } }, ["snapshotId", "ref", "text"]) },
  { name: "browser_press", description: "Focus a snapshot element and press one key. No system shortcuts or modifiers. Inspect afterward to check the result.", inputSchema: schema({ ...refProperties, key: { type: "string", enum: ["Enter","Escape","Tab","Backspace","Delete","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"] } }, ["snapshotId", "ref", "key"]) },
  { name: "browser_scroll", description: "Scroll the page vertically by bounded CSS pixels, then take a fresh snapshot.", inputSchema: schema({ deltaY: { type: "number", minimum: -5000, maximum: 5000 } }, ["deltaY"]) },
  { name: "browser_screenshot", description: "Capture the visible viewport as a bounded image, not the full page. Visible content may be sensitive.", inputSchema: schema() },
  { name: "browser_diagnostics", description: "Read bounded console messages, load failures and crashes since this page's last navigation. On demand only; may include sensitive page text. Not a network request log.", inputSchema: schema() },
] as const;

export async function callBrowserTool(target: BrowserTarget, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = BROWSER_TOOLS.find((entry) => entry.name === name);
  if (!tool) return { ok: false, detail: `No such tool: ${name}.` };
  if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, detail: "Tool arguments must be an object." };
  if (Object.keys(args).some((key) => !(key in tool.inputSchema.properties))) return { ok: false, detail: "Unexpected tool arguments. Check tools/list for the supported fields." };
  try {
    target.check?.();
    switch (name) {
      case "browser_status": return await browserStatus(target);
      case "browser_navigate": return await browserNavigate(target, args.url);
      case "browser_snapshot": return await browserSnapshot(target);
      case "browser_screenshot": return await browserScreenshot(target);
      case "browser_scroll": return await browserScroll(target, args.deltaY);
      case "browser_diagnostics": {
        const page = target.contents();
        return page ? { ok: true, detail: "Recent page diagnostics (at most 80 entries). No network bodies or headers are recorded.", data: browserDiagnostics(page) } : { ok: false, detail: "Open a page with browser_navigate first." };
      }
      case "browser_press": return await browserPress(target, { snapshotId: args.snapshotId as string, ref: args.ref as number, key: args.key });
      default: return await browserInteract(target, { action: name === "browser_type" ? "type" : name === "browser_select" ? "select" : "click", snapshotId: args.snapshotId as string, ref: args.ref as number, text: args.text as string });
    }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "The browser operation failed." };
  }
}

function toolPayload(result: ToolResult): Record<string, unknown> {
  const text = result.data ? `${result.detail}\n\n${JSON.stringify(result.data)}` : result.detail;
  return { content: [
    { type: "text", text },
    ...(result.image ? [{ type: "image", ...result.image }] : []),
  ], isError: !result.ok };
}

const activeTargets = new WeakSet<BrowserTarget>();

export async function handleMcpRequest(target: BrowserTarget, input: unknown): Promise<Record<string, unknown> | undefined> {
  const invalid = { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request." } };
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid;
  const request = input as Record<string, unknown>;
  const { id, method } = request;
  if (request.jsonrpc !== "2.0" || typeof method !== "string" || (id !== undefined && typeof id !== "string" && typeof id !== "number")) return invalid;
  // Notifications cannot invoke side-effecting methods, even if they name one.
  if (id === undefined) return undefined;
  const reply = (result: Record<string, unknown>) => ({ jsonrpc: "2.0", id, result });
  const params = request.params ?? {};
  if (!params || typeof params !== "object" || Array.isArray(params)) return { ...invalid, id };
  const values = params as Record<string, unknown>;
  switch (method) {
    case "initialize": return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "capsule-browser", version: "2" } });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: BROWSER_TOOLS });
    case "tools/call": {
      if (activeTargets.has(target)) return reply(toolPayload({ ok: false, detail: "A browser operation is already in progress. Wait for it to finish; do not retry side effects blindly." }));
      activeTargets.add(target);
      const finish = localTimings.start("browser.tool");
      try {
        const result = await callBrowserTool(target, typeof values.name === "string" ? values.name : "", (values.arguments ?? {}) as Record<string, unknown>);
        finish(!result.ok);
        return reply(toolPayload(result));
      } finally { finish(true); activeTargets.delete(target); }
    }
    default: return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } };
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 64_000) throw new Error("Request body too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface BrowserMcpConnection {
  url: string;
  headers: Record<string, string>;
  dispose(): void;
}
export interface BrowserMcpServer {
  /** Mint a distinct revocable credential for each native agent process. */
  register(target: BrowserTarget): BrowserMcpConnection;
  close(): Promise<void>;
}

/** Loopback is not authentication. Tokens are process-scoped, never global. */
export function startBrowserMcpServer(
  admit: (operation: () => Promise<Record<string, unknown> | undefined>) => Promise<Record<string, unknown> | undefined> = (operation) => operation(),
): Promise<BrowserMcpServer> {
  const clients = new Map<string, BrowserTarget>();
  let port = 0, inFlight = 0;
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
    };
    if (request.headers.origin || request.headers.host !== `127.0.0.1:${port}`) { send(403, { error: "Browser origins and non-loopback hosts are not accepted." }); return; }
    const target = clients.get(request.headers.authorization ?? "");
    if (!target) { send(401, { error: "Unauthorized" }); return; }
    if (request.url !== "/mcp") { send(404, { error: "Not found" }); return; }
    if (request.method !== "POST") { send(405, { error: "Use POST." }); return; }
    if (!request.headers["content-type"]?.startsWith("application/json")) { send(415, { error: "Use application/json." }); return; }
    if (inFlight >= 8) { send(429, { error: "Too many browser requests." }); return; }
    inFlight++;
    void (async () => {
      try {
        const parsed: unknown = JSON.parse(await readBody(request));
        const answer = await admit(() => handleMcpRequest(target, parsed));
        if (answer) send(200, answer);
        else response.writeHead(202).end();
      } catch (error) {
        send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof Error ? error.message : "Bad request" } });
      } finally { inFlight--; }
    })();
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { reject(new Error("Browser server did not report a port.")); return; }
      port = address.port;
      resolve({
        register: (target) => {
          if (clients.size >= 128) throw new Error("Too many agent browser sessions. Close an unused agent first.");
          const auth = `Bearer ${randomBytes(24).toString("base64url")}`;
          let active = true;
          const check = () => { if (!active) throw new Error("This agent's browser credential has expired."); target.check?.(); };
          const scoped: BrowserTarget = {
            check, contents: () => { check(); return target.contents(); },
            open: async (url) => { check(); const page = await target.open?.(url); check(); return page; },
          };
          clients.set(auth, scoped);
          return { url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: auth }, dispose: () => { active = false; clients.delete(auth); } };
        },
        close: () => { clients.clear(); server.closeAllConnections(); return new Promise<void>((done) => server.close(() => done())); },
      });
    });
  });
}
