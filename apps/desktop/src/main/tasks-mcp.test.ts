import { describe, expect, it } from "vitest";
import { startTasksMcpServer } from "./tasks-mcp";

const post = async (url: string, headers: Record<string, string>, body: unknown) => {
  const response = await fetch(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as { result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }> } } };
};

describe("capsule-tasks server", () => {
  it("routes a token's calls to its own thread and lists the three tools", async () => {
    const calls: Array<[string, string]> = [];
    const server = await startTasksMcpServer(async (threadId, name) => { calls.push([threadId, name]); return { ok: true, detail: `${name} for ${threadId}` }; });
    try {
      const a = server.register({ threadId: "thread-a" });
      const b = server.register({ threadId: "thread-b" });
      const listed = await post(a.url, a.headers, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(listed.body.result?.tools?.map((tool) => tool.name)).toEqual(["create_task", "start_task", "list_tasks"]);
      const called = await post(b.url, b.headers, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_tasks", arguments: {} } });
      expect(called.body.result?.content?.[0]?.text).toBe("list_tasks for thread-b");
      expect(calls).toEqual([["thread-b", "list_tasks"]]);
      b.dispose();
      expect((await post(b.url, b.headers, { jsonrpc: "2.0", id: 3, method: "tools/list" })).status).toBe(401);
    } finally {
      await server.close();
    }
  });
});
