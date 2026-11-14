import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { startRemoteServer, type RemoteServerHandle } from "./server.js";
import { createTlsIdentity, loadOrCreateTlsIdentity, phonePortFile, phoneSessionFile } from "./tls.js";

/*
 * Phone pairing end to end: a code minted for the TLS listener pairs there
 * with control, is refused on the plain listener, and the plain listener's
 * links are refused on the TLS one. A browser (anything sending Origin) is
 * kept off the phone listener entirely.
 */

const identity = createTlsIdentity("Test computer");
let handle: RemoteServerHandle;

beforeAll(async () => {
  const serveDir = mkdtempSync(path.join(tmpdir(), "capsule-phone-"));
  writeFileSync(path.join(serveDir, "index.html"), "<!doctype html><title>Capsule</title>");
  handle = await startRemoteServer({
    serveDir,
    reach: "network",
    tls: identity,
    hostName: "Test computer.local",
    invoke: async (channel) => ({ channel }),
    subscribe: () => () => {},
  });
});

afterAll(async () => {
  await handle?.stop();
});

function phoneCode(): URL {
  return new URL(handle.pair(["read", "control"], "phone"));
}

function tlsFetch(port: number, pathName: string, body: unknown, headers: Record<string, string> = {}):
  Promise<{ status: number; json: Record<string, unknown>; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1", port, path: pathName, method: "POST", rejectUnauthorized: false,
      agent: false,
      headers: { "content-type": "application/json", host: `127.0.0.1:${port}`, ...headers },
    }, (response) => {
      let text = "";
      // Read the certificate now: the socket is detached once the body ends.
      const peer = (response.socket as import("node:tls").TLSSocket).getPeerCertificate(true);
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          json: JSON.parse(text || "{}") as Record<string, unknown>,
          fingerprint: createHash("sha256").update(peer.raw).digest("hex"),
        });
      });
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

function ready(port: number, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://127.0.0.1:${port}/rpc`, { rejectUnauthorized: false });
    const timer = setTimeout(() => { socket.close(); reject(new Error("timed out")); }, 5_000);
    socket.on("open", () => socket.send(JSON.stringify({ token })));
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string };
      if (frame.type === "ready") {
        socket.send(JSON.stringify({ id: 1, channel: "sendMessage", args: [{}] }));
        return;
      }
      clearTimeout(timer);
      socket.close();
      resolve(frame);
    });
    socket.on("close", (code) => { clearTimeout(timer); resolve({ closed: code }); });
    socket.on("error", () => {});
  });
}

function readyFrame(port: number, token: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://127.0.0.1:${port}/rpc`, { rejectUnauthorized: false });
    const timer = setTimeout(() => { socket.close(); reject(new Error("timed out")); }, 5_000);
    socket.on("open", () => socket.send(JSON.stringify({ token })));
    socket.on("message", (raw) => { clearTimeout(timer); socket.close(); resolve(JSON.parse(String(raw)) as Record<string, unknown>); });
    socket.on("error", () => {});
  });
}

describe("phone pairing", () => {
  it("is offered on This network, with a code that pins the certificate", () => {
    expect(handle.phoneAvailable).toBe(true);
    const code = phoneCode();
    expect(code.protocol).toBe("capsule:");
    expect(code.searchParams.get("fp")).toBe(identity.fingerprint);
    expect(code.searchParams.get("name")).toBe("Test computer");
    expect(Number(code.searchParams.get("port"))).toBeGreaterThan(0);
  });

  it("pairs over TLS with control, and the presented certificate is the pinned one", async () => {
    const code = phoneCode();
    const port = Number(code.searchParams.get("port"));
    const paired = await tlsFetch(port, "/pair", { token: code.searchParams.get("token"), label: "Phone" });
    expect(paired.status).toBe(200);
    expect(paired.json.scopes).toEqual(["read", "control"]);
    expect(paired.fingerprint).toBe(identity.fingerprint);
    // Control reaches the handler: the scope survives the socket.
    expect(await ready(port, String(paired.json.token))).toMatchObject({ type: "result", id: 1, result: { channel: "sendMessage" } });
    expect(handle.sessions().find((session) => session.transport === "phone")).toBeTruthy();
  });

  it("refuses a phone code on the plain listener", async () => {
    const code = phoneCode();
    // The plain listener answers on the address it advertises.
    const response = await fetch(`${handle.url}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: code.searchParams.get("token") }),
    });
    expect(response.status).toBe(401);
  });

  it("refuses a browser link on the phone listener", async () => {
    const link = handle.pair(["read"]);
    const token = link.split("#pair=")[1];
    const port = Number(phoneCode().searchParams.get("port"));
    expect((await tlsFetch(port, "/pair", { token })).status).toBe(401);
  });

  it("keeps browsers off the phone listener", async () => {
    const code = phoneCode();
    const port = Number(code.searchParams.get("port"));
    const response = await tlsFetch(port, "/pair", { token: code.searchParams.get("token") }, { origin: "https://example.com" });
    expect(response.status).toBe(403);
    // Refused before the grant was looked at, so the code still works.
    expect((await tlsFetch(port, "/pair", { token: code.searchParams.get("token") })).status).toBe(200);
  });

  it("still refuses browser control over plain network HTTP", () => {
    expect(() => handle.pair(["read", "control"])).toThrow(/loopback/u);
  });
});

describe("phone pairings across restarts", () => {
  it("keeps a phone pairing when the server restarts, and not a browser one", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-persist-"));
    const store = phoneSessionFile(dir);
    const serveDir = mkdtempSync(path.join(tmpdir(), "capsule-phone-serve-"));
    const start = () => startRemoteServer({ serveDir, reach: "loopback", tls: identity, phoneSessions: store,
      invoke: async (channel) => ({ channel }), subscribe: () => () => {} });
    const first = await start();
    const code = new URL(first.pair(["read", "control"], "phone"));
    const port = Number(code.searchParams.get("port"));
    const paired = await tlsFetch(port, "/pair", { token: code.searchParams.get("token"), label: "Phone" });
    expect(paired.status).toBe(200);
    await first.stop();

    const second = await start();
    expect(second.sessions().map((session) => session.transport)).toEqual(["phone"]);
    second.revoke(second.sessions()[0]!.id);
    await second.stop();
    expect(store.load()).toEqual([]);
  });

  it("never writes a usable token", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-persist-"));
    const store = phoneSessionFile(dir);
    store.save([{ id: "remote_x", transport: "phone", tokenHash: "ab", scopes: ["read"], label: "P", createdAt: 1, lastSeenAt: 1, expiresAt: Date.now() + 1000 }]);
    expect(readFileSync(path.join(dir, "remote-phone-sessions.json"), "utf8")).not.toMatch(/"token"/u);
    store.clear();
    expect(store.load()).toEqual([]);
  });
});

describe("phone pairing lifetime and address", () => {
  it("lasts thirty days, renews on each connection, and says so in ready", async () => {
    const code = phoneCode();
    const port = Number(code.searchParams.get("port"));
    const paired = await tlsFetch(port, "/pair", { token: code.searchParams.get("token"), label: "Phone" });
    expect(Number(paired.json.expiresAt) - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60_000);
    const ready = await readyFrame(port, String(paired.json.token));
    expect(Number(ready.expiresAt)).toBeGreaterThanOrEqual(Number(paired.json.expiresAt));
  });

  it("keeps a thirty-day session connected (no timer overflow)", async () => {
    const code = phoneCode();
    const port = Number(code.searchParams.get("port"));
    const paired = await tlsFetch(port, "/pair", { token: code.searchParams.get("token"), label: "Phone" });
    const closed = await new Promise<number | "open">((resolve) => {
      const socket = new WebSocket(`wss://127.0.0.1:${port}/rpc`, { rejectUnauthorized: false });
      socket.on("open", () => socket.send(JSON.stringify({ token: paired.json.token })));
      socket.on("close", (code) => resolve(code));
      socket.on("error", () => {});
      setTimeout(() => { socket.close(); resolve("open"); }, 300);
    });
    expect(closed).toBe("open");
  });

  it("advertises the phone listener on This network only, and withdraws it on stop", async () => {
    const serveDir = mkdtempSync(path.join(tmpdir(), "capsule-advert-"));
    const adverts: Array<{ port: number; fingerprint: string; name: string }> = [];
    let withdrawn = 0;
    const start = (reach: "loopback" | "network") => startRemoteServer({ serveDir, reach, tls: identity, hostName: "Studio",
      advertise: (advert) => { adverts.push(advert); return () => { withdrawn++; }; },
      invoke: async () => null, subscribe: () => () => {} });
    const loopback = await start("loopback");
    expect(adverts).toEqual([]);
    await loopback.stop();
    const network = await start("network");
    expect(adverts).toHaveLength(1);
    expect(adverts[0]).toMatchObject({ fingerprint: identity.fingerprint, name: "Studio" });
    await network.stop();
    expect(withdrawn).toBe(1);
  });

  it("reuses the remembered port, and moves on when it is taken", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-port-"));
    const ports = phonePortFile(dir);
    const serveDir = mkdtempSync(path.join(tmpdir(), "capsule-port-serve-"));
    const start = () => startRemoteServer({ serveDir, reach: "loopback", tls: identity, phonePortStore: ports,
      invoke: async () => null, subscribe: () => () => {} });
    const first = await start();
    const remembered = ports.load();
    expect(remembered).toBeGreaterThan(0);
    await first.stop();
    const second = await start();
    expect(Number(new URL(second.pair(["read"], "phone")).searchParams.get("port"))).toBe(remembered);
    const third = await start(); // second still holds the port
    expect(ports.load()).not.toBe(remembered);
    await second.stop();
    await third.stop();
  });
});

describe("TLS identity", () => {
  it("is created once and reused", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-tls-"));
    const first = loadOrCreateTlsIdentity(dir);
    const second = loadOrCreateTlsIdentity(dir);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("replaces a corrupt certificate", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-tls-"));
    const first = loadOrCreateTlsIdentity(dir);
    writeFileSync(path.join(dir, "remote-tls-cert.pem"), "garbage");
    expect(loadOrCreateTlsIdentity(dir).fingerprint).not.toBe(first.fingerprint);
  });
});
