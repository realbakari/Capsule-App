import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";

/**
 * A loopback HTTP MCP server with one revocable bearer token per agent
 * process. The browser tools have their own copy of this transport; this one
 * is generic so a second tool family does not grow a second set of rules.
 * Loopback is not authentication: tokens are process-scoped, never global.
 */

const PROTOCOL_VERSION = "2025-06-18";

export interface LocalToolResult {
  ok: boolean;
  detail: string;
  data?: unknown;
  image?: { data: string; mimeType: "image/jpeg" };
}

export interface LocalMcpTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

export interface LocalMcpConnection {
  url: string;
  headers: Record<string, string>;
  dispose(): void;
}

export interface LocalMcpServer<Target> {
  register(target: Target): LocalMcpConnection;
  close(): Promise<void>;
}

export const toolSchema = (properties: Record<string, unknown> = {}, required: string[] = []) =>
  ({ type: "object" as const, properties, required, additionalProperties: false as const });

function toolPayload(result: LocalToolResult): Record<string, unknown> {
  const text = result.data ? `${result.detail}\n\n${JSON.stringify(result.data)}` : result.detail;
  return { content: [{ type: "text", text }, ...(result.image ? [{ type: "image", ...result.image }] : [])], isError: !result.ok };
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

export interface LocalMcpOptions<Target> {
  name: string;
  version: string;
  tools: readonly LocalMcpTool[];
  call(target: Target, name: string, args: Record<string, unknown>): Promise<LocalToolResult>;
  /** Wrap each call, for example in update admission. */
  admit?: (operation: () => Promise<Record<string, unknown> | undefined>) => Promise<Record<string, unknown> | undefined>;
  /** Spawning a browser alone is cheap; a tool family that is still useful at 128 agents is unlikely. */
  maxClients?: number;
}

export async function handleLocalMcpRequest<Target>(options: LocalMcpOptions<Target>, target: Target, busy: Set<Target>, input: unknown): Promise<Record<string, unknown> | undefined> {
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
    case "initialize": return reply({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: options.name, version: options.version } });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: options.tools });
    case "tools/call": {
      if (busy.has(target)) return reply(toolPayload({ ok: false, detail: "An operation is already in progress on this device. Wait for it to finish; do not retry side effects blindly." }));
      busy.add(target);
      try {
        const name = typeof values.name === "string" ? values.name : "";
        const args = (values.arguments ?? {}) as Record<string, unknown>;
        const tool = options.tools.find((entry) => entry.name === name);
        if (!tool) return reply(toolPayload({ ok: false, detail: `No such tool: ${name}.` }));
        if (!args || typeof args !== "object" || Array.isArray(args)) return reply(toolPayload({ ok: false, detail: "Tool arguments must be an object." }));
        if (Object.keys(args).some((key) => !(key in tool.inputSchema.properties))) return reply(toolPayload({ ok: false, detail: "Unexpected tool arguments. Check tools/list for the supported fields." }));
        let result: LocalToolResult;
        try {
          result = await options.call(target, name, args);
        } catch (error) {
          result = { ok: false, detail: error instanceof Error ? error.message : "The operation failed." };
        }
        return reply(toolPayload(result));
      } finally { busy.delete(target); }
    }
    default: return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } };
  }
}

export function startLocalMcpServer<Target extends object>(options: LocalMcpOptions<Target>): Promise<LocalMcpServer<Target>> {
  const clients = new Map<string, { target: Target; check: () => void }>();
  const busy = new Set<Target>();
  const admit = options.admit ?? ((operation) => operation());
  let port = 0, inFlight = 0;
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
    };
    if (request.headers.origin || request.headers.host !== `127.0.0.1:${port}`) { send(403, { error: "Browser origins and non-loopback hosts are not accepted." }); return; }
    const client = clients.get(request.headers.authorization ?? "");
    if (!client) { send(401, { error: "Unauthorized" }); return; }
    if (request.url !== "/mcp") { send(404, { error: "Not found" }); return; }
    if (request.method !== "POST") { send(405, { error: "Use POST." }); return; }
    if (!request.headers["content-type"]?.startsWith("application/json")) { send(415, { error: "Use application/json." }); return; }
    if (inFlight >= 8) { send(429, { error: "Too many requests." }); return; }
    inFlight++;
    void (async () => {
      try {
        const parsed: unknown = JSON.parse(await readBody(request));
        client.check();
        const answer = await admit(() => handleLocalMcpRequest(options, client.target, busy, parsed));
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
      if (!address || typeof address === "string") { reject(new Error(`${options.name} did not report a port.`)); return; }
      port = address.port;
      resolve({
        register: (target) => {
          if (clients.size >= (options.maxClients ?? 128)) throw new Error("Too many agent sessions. Close an unused agent first.");
          const auth = `Bearer ${randomBytes(24).toString("base64url")}`;
          let active = true;
          clients.set(auth, { target, check: () => { if (!active) throw new Error("This agent's credential has expired."); } });
          return { url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: auth }, dispose: () => { active = false; clients.delete(auth); } };
        },
        close: () => { clients.clear(); server.closeAllConnections(); return new Promise<void>((done) => server.close(() => done())); },
      });
    });
  });
}
