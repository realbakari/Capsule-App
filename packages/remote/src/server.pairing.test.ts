import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { startRemoteServer, type RemoteServerHandle } from "./server.js";

/*
 * The whole flow, against the real server: pair, connect, read, and be
 * refused. The unit tests prove the rules; this proves they are the ones the
 * socket actually applies.
 */

const called: string[] = [];
let handle: RemoteServerHandle;
let base: string;

beforeAll(async () => {
  const serveDir = mkdtempSync(path.join(tmpdir(), "capsule-remote-"));
  writeFileSync(path.join(serveDir, "index.html"), "<!doctype html><title>Capsule</title>");
  handle = await startRemoteServer({
    serveDir,
    reach: "loopback",
    invoke: async (channel) => {
      called.push(channel);
      return { channel };
    },
    subscribe: () => () => undefined,
  });
  base = `http://127.0.0.1:${handle.port}`;
});

afterAll(async () => {
  await handle?.stop();
});

async function pair(token: string): Promise<{ status: number; token?: string }> {
  const response = await fetch(`${base}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, label: "Test device" }),
  });
  const body = (await response.json()) as { token?: string };
  return { status: response.status, ...(body.token ? { token: body.token } : {}) };
}

function rpc(token: string, frames: Array<Record<string, unknown>>): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${handle.port}/rpc`);
    const received: unknown[] = [];
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("timed out"));
    }, 5_000);
    socket.on("open", () => socket.send(JSON.stringify({ token })));
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string };
      if (frame.type === "ready") {
        for (const message of frames) socket.send(JSON.stringify(message));
        return;
      }
      received.push(frame);
      if (received.length === frames.length) {
        clearTimeout(timer);
        socket.close();
        resolve(received);
      }
    });
    socket.on("close", (code) => {
      if (received.length < frames.length) {
        clearTimeout(timer);
        resolve([{ closed: code }]);
      }
    });
    socket.on("error", reject);
  });
}

describe("pairing a device", () => {
  it("serves the app to anyone, and the workspace to nobody", async () => {
    const page = await fetch(base);
    expect(page.status).toBe(200);
    // Loading the page is not being paired: the socket refuses a caller with
    // no session and closes it.
    const refused = await rpc("not-a-real-token", [{ id: 1, channel: "listSessions", args: [] }]);
    expect(refused).toEqual([{ closed: 4401 }]);
  });

  it("takes a pairing link once", async () => {
    const url = handle.pair(["read"]);
    const token = url.slice(url.indexOf("#pair=") + 6);
    const first = await pair(token);
    expect(first.status).toBe(200);
    expect(first.token).toBeTruthy();
    // The same link again is worth nothing.
    expect((await pair(token)).status).toBe(401);
  });

  it("lets a paired reader read, and refuses everything else", async () => {
    const url = handle.pair(["read"]);
    const session = await pair(url.slice(url.indexOf("#pair=") + 6));
    expect(session.token).toBeTruthy();
    called.length = 0;

    const frames = (await rpc(session.token!, [
      { id: 1, channel: "listSessions", args: [] },
      { id: 2, channel: "terminalStart", args: [{ cwd: "/" }] },
    ])) as Array<{ id: number; result?: unknown; error?: string }>;
    // Matched by id, not arrival: a refusal is immediate while a real call
    // waits on a handler, so the answers come back out of order.
    const allowed = frames.find((frame) => frame.id === 1);
    const refused = frames.find((frame) => frame.id === 2);

    expect(allowed?.result).toEqual({ channel: "listSessions" });
    expect(refused?.error).toContain("may not call terminalStart");
    // The refusal happens before the handler: a shell was never opened.
    expect(called).toEqual(["listSessions"]);
  });

  it("stops answering a revoked device", async () => {
    const url = handle.pair(["read"]);
    const session = await pair(url.slice(url.indexOf("#pair=") + 6));
    const paired = handle.sessions().at(-1);
    expect(paired).toBeTruthy();
    handle.revoke(paired!.id);
    expect(await rpc(session.token!, [{ id: 1, channel: "listSessions", args: [] }])).toEqual([
      { closed: 4401 },
    ]);
  });
});
