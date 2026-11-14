import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { probeMcpServer } from "./mcp-probe.js";

const closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

it("lists an HTTP server's tools through a session, reading an event-stream answer", async () => {
  const seen: Array<{ method: string; session?: string; auth?: string }> = [];
  const url = await serve((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const message = JSON.parse(body) as { id?: number; method: string };
      seen.push({ method: message.method, session: request.headers["mcp-session-id"] as string | undefined, auth: request.headers.authorization });
      if (message.method === "initialize") {
        response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s-1" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }));
      } else if (message.id === undefined) {
        response.writeHead(202).end();
      } else {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "query" }] } })}\n\n`);
      }
    });
  });
  const result = await probeMcpServer({ url, headers: { Authorization: "Bearer t" } }, { cwd: process.cwd(), env: process.env });
  expect(result).toMatchObject({ ok: true, tools: ["query"] });
  expect(seen).toEqual([
    { method: "initialize", auth: "Bearer t" },
    { method: "notifications/initialized", session: "s-1", auth: "Bearer t" },
    { method: "tools/list", session: "s-1", auth: "Bearer t" },
  ]);
});

it("names the status when an HTTP server refuses", async () => {
  const url = await serve((_request, response) => response.writeHead(401, "Unauthorized").end());
  expect(await probeMcpServer({ url }, { cwd: process.cwd(), env: process.env })).toMatchObject({ ok: false, error: `${url} answered 401 Unauthorized.` });
});

it("gives up on a silent server after its timeout", async () => {
  const result = await probeMcpServer({ command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] }, { cwd: process.cwd(), env: process.env, timeoutMs: 300 });
  expect(result).toMatchObject({ ok: false, error: "No answer within 1 second." });
});
