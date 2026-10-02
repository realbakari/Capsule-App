import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CapsuleEngine } from "@capsule/core";
import { startRemoteServer } from "@capsule/remote";
import type { Run, Session } from "@capsule/shared";
import WebSocket from "ws";
import { expect, it, vi } from "vitest";
import { remoteControlArgs } from "./remote-control";

it("carries a paired browser conversation through the host engine without granting administration", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-web-flow-"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Capsule</title>");
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  const project = engine.createProject({ name: "Browser workspace", defaultMode: "code" });
  const server = await startRemoteServer({ serveDir: dir, reach: "loopback",
    invoke: async (channel, raw) => {
      const args = remoteControlArgs(channel, raw);
      if (channel === "createSession") return engine.createSession(args[0] as Parameters<typeof engine.createSession>[0]);
      if (channel === "sendMessage") return engine.sendMessage(args[0] as Parameters<typeof engine.sendMessage>[0]);
      if (channel === "listMessages") return engine.listMessages(String(args[0]));
      if (channel === "listArtifacts") return engine.listArtifacts(String(args[0]));
      throw new Error("Unexpected handler");
    }, subscribe: () => () => {},
  });
  const origin = `http://127.0.0.1:${server.port}`;
  let socket: WebSocket | undefined;
  try {
    const token = server.pair(["read", "control"]).split("#pair=")[1];
    const response = await fetch(`${origin}/pair`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token, label: "Browser test" }) });
    expect(response.status).toBe(200);
    const paired = await response.json() as { token: string };
    socket = new WebSocket(`ws://127.0.0.1:${server.port}/rpc`, { origin });
    const connection = socket;
    const frames: Array<{ id?: number; type?: string; result?: unknown; error?: string }> = [];
    connection.on("message", (raw) => frames.push(JSON.parse(String(raw))));
    await new Promise<void>((resolve, reject) => { connection.once("open", resolve); connection.once("error", reject); });
    connection.send(JSON.stringify({ token: paired.token }));
    await vi.waitFor(() => expect(frames.some((frame) => frame.type === "ready")).toBe(true));
    let id = 0;
    const call = async (channel: string, args: unknown[]) => {
      const requestId = ++id;
      connection.send(JSON.stringify({ id: requestId, channel, args }));
      await vi.waitFor(() => expect(frames.some((frame) => frame.id === requestId)).toBe(true));
      return frames.find((frame) => frame.id === requestId)!;
    };
    const created = await call("createSession", [{ projectId: project.id, agentId: "coding", mode: "code", permissionProfile: "approve-all" }]);
    expect(created.error).toBeUndefined();
    const session = created.result as Session;
    expect(session.permissionProfile).toBe("strict");
    const sent = await call("sendMessage", [{ sessionId: session.id, content: "Build the API", agentId: "coding", mode: "code" }]);
    expect(sent.error).toBeUndefined();
    const { run } = sent.result as { run: Run };
    await vi.waitFor(() => expect(engine.getRun(run.id)?.status).toBe("completed"), { timeout: 5000 });
    const messages = await call("listMessages", [session.id]);
    expect(messages.result).toEqual(expect.arrayContaining([expect.objectContaining({ role: "assistant" })]));
    expect((await call("listArtifacts", [run.id])).result).toEqual([]);
    expect(engine.listRunEvents(run.id).some((event) => event.type === "contract")).toBe(true);
    expect((await call("updateSettings", [{ analyticsEnabled: true }])).error).toContain("may not call");
  } finally {
    socket?.terminate();
    await server.stop();
    await engine.stop();
  }
}, 15_000);
