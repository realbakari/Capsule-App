import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

import {
  browserNavigate,
  browserSnapshot,
  browserStatus,
  type BrowserTarget,
  type ToolResult,
} from "./browser-tools";

/**
 * The browser tools, offered to an agent over MCP.
 *
 * Both agents Capsule spawns itself report `mcpCapabilities: {http: true}`, so
 * this is an HTTP server in the main process rather than a subprocess: the
 * agent talks straight to the process that owns the browser, with no child to
 * supervise and no second hop to keep in step.
 *
 * Bound to loopback, on a port the operating system chooses, behind a token
 * minted per run. Anything on this machine can reach a loopback port, and
 * these tools drive a real browser — the token is what makes the URL, handed
 * only to the agent Capsule spawned, the thing that grants access.
 */

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

/** The tools, as the agent is told about them. */
export const BROWSER_TOOLS = [
  {
    name: "browser_status",
    description:
      "What Capsule's browser panel is showing: the current URL and page title. Call this first to find out whether a page is open.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "browser_navigate",
    description:
      "Open an http or https URL in Capsule's browser panel. The person using Capsule can see this page.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "An http or https URL." } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "browser_snapshot",
    description:
      "Read the open page: its visible text, plus a numbered list of the links, buttons and fields on it. Prefer these over screen coordinates.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

export async function callBrowserTool(
  target: BrowserTarget,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "browser_status":
      return await browserStatus(target);
    case "browser_navigate":
      return await browserNavigate(target, args.url);
    case "browser_snapshot":
      return await browserSnapshot(target);
    default:
      return { ok: false, detail: `No such tool: ${name}.` };
  }
}

/*
 * MCP wants the human-readable answer in `content` and marks failure with
 * `isError`. The structured payload rides alongside, so an agent that reads
 * only the text still learns what happened.
 */
function toolPayload(result: ToolResult): Record<string, unknown> {
  const text = result.data
    ? `${result.detail}\n\n${JSON.stringify(result.data, null, 2)}`
    : result.detail;
  return { content: [{ type: "text", text }], isError: !result.ok };
}

export async function handleMcpRequest(
  target: BrowserTarget,
  request: JsonRpcRequest,
): Promise<Record<string, unknown> | undefined> {
  const { id, method, params } = request;
  // A notification carries no id and expects no reply.
  const reply = (result: Record<string, unknown>) => ({ jsonrpc: "2.0", id, result });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "capsule-browser", version: "1" },
      });
    case "notifications/initialized":
      return undefined;
    case "tools/list":
      return reply({ tools: BROWSER_TOOLS });
    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : "";
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      return reply(toolPayload(await callBrowserTool(target, name, args)));
    }
    default:
      if (id === undefined || id === null) return undefined;
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } };
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    // A tool call is small; anything large is not one.
    if (size > 1_000_000) throw new Error("Request body too large.");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface BrowserMcpServer {
  /** What to hand the agent in `mcpServers`. */
  url: string;
  headers: Record<string, string>;
  close(): Promise<void>;
}

/**
 * Start the server, on loopback and a port the OS picks.
 *
 * Resolves once it is listening, because the URL has to be in hand before the
 * agent is told about it.
 */
export function startBrowserMcpServer(target: BrowserTarget): Promise<BrowserMcpServer> {
  const token = randomBytes(24).toString("base64url");
  const server: Server = createServer((request, response) => {
    void serve(target, token, request, response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The browser tool server did not report a port."));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

async function serve(
  target: BrowserTarget,
  token: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const send = (status: number, body: unknown) => {
    const text = JSON.stringify(body);
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(text),
      /*
       * Nothing here is for a browser to fetch. Saying so keeps a page the
       * agent itself opened from reaching back through this port.
       */
      "access-control-allow-origin": "null",
    });
    response.end(text);
  };

  /*
   * The token, not the port, is the boundary: any process on this machine can
   * connect to loopback, and these tools drive a browser.
   */
  const auth = request.headers.authorization ?? "";
  if (auth !== `Bearer ${token}`) {
    send(401, { error: "Unauthorized" });
    return;
  }
  if (request.method !== "POST") {
    send(405, { error: "Use POST." });
    return;
  }

  try {
    const body = await readBody(request);
    const parsed = JSON.parse(body) as JsonRpcRequest | JsonRpcRequest[];
    // A batch is legal JSON-RPC and some clients send one.
    if (Array.isArray(parsed)) {
      const replies = [];
      for (const item of parsed) {
        const answer = await handleMcpRequest(target, item);
        if (answer) replies.push(answer);
      }
      if (replies.length === 0) {
        response.writeHead(202).end();
        return;
      }
      send(200, replies);
      return;
    }
    const answer = await handleMcpRequest(target, parsed);
    if (!answer) {
      // A notification is acknowledged with no body.
      response.writeHead(202).end();
      return;
    }
    send(200, answer);
  } catch (error) {
    send(400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: error instanceof Error ? error.message : "Bad request" },
    });
  }
}
