import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";

import { isChannelAllowed, type IpcScope } from "@capsule/shared";
import { WebSocketServer, type WebSocket } from "ws";

import {
  exchangeGrant,
  issueGrant,
  pruneExpired,
  resolveSession,
  type PairingGrant,
  type RemoteSession,
} from "./pairing.js";

/*
 * Capsule, read from another device.
 *
 * Everything here is off unless someone turns it on. The server binds to
 * loopback by default; reaching it from a phone is a second, explicit choice,
 * and it is the only setting in the app that puts a socket on the network.
 */

export interface RemoteServerOptions {
  /** Where the built renderer lives, so a browser has something to load. */
  serveDir: string;
  /** "loopback" is this Mac only. "network" is any device that can reach it. */
  reach: "loopback" | "network";
  port?: number;
  /** Calls the same handlers the desktop window calls. */
  invoke: (channel: string, args: unknown[]) => Promise<unknown>;
  /** Subscribes to the events the desktop window receives. */
  subscribe: (send: (event: string, payload: unknown) => void) => () => void;
  onChange?: () => void;
}

export interface RemoteServerHandle {
  url: string;
  port: number;
  /** Mints a single-use link. The token is only ever returned here. */
  pair: (scopes: IpcScope[]) => string;
  sessions: () => RemoteSession[];
  revoke: (id: string) => void;
  stop: () => Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** The address another device would use, when the server is reachable at all. */
export function lanAddress(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      // Node types this as a string; older runtimes reported the number 4.
      const family = entry.family as string | number;
      if (!entry.internal && (family === "IPv4" || family === 4)) return entry.address;
    }
  }
  return undefined;
}

/** Resolves a request path inside the served directory, or nothing. */
export function resolveStaticFile(serveDir: string, requestPath: string): string | undefined {
  let relative: string;
  try {
    relative = decodeURIComponent(requestPath.split("?")[0] ?? "/").replace(/^\/+/u, "");
  } catch {
    return undefined;
  }
  const target = path.resolve(serveDir, relative || "index.html");
  const root = path.resolve(serveDir);
  // Containment: a request for ../../etc/passwd must not escape the folder.
  const inside = target === root || target.startsWith(`${root}${path.sep}`);
  if (!inside) return undefined;
  try {
    if (statSync(target).isFile()) return target;
  } catch {
    // Missing, malformed, or removed between resolution and stat.
  }
  const index = path.join(root, "index.html");
  return existsSync(index) ? index : undefined;
}

export async function startRemoteServer(
  options: RemoteServerOptions,
): Promise<RemoteServerHandle> {
  const grants: PairingGrant[] = [];
  let sessions: RemoteSession[] = [];
  const sockets = new Set<WebSocket>();
  const disconnectBySocket = new Map<WebSocket, { sessionId: string; disconnect: () => void }>();

  const host = options.reach === "network" ? "0.0.0.0" : "127.0.0.1";

  function readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      request.on("data", (chunk) => {
        if (body.length > 4_096) return;
        body += chunk;
        // A pairing request is a few dozen bytes; anything larger is not one.
        if (body.length > 4_096) reject(new Error("Request too large"));
      });
      request.on("end", () => resolve(body));
      request.on("error", reject);
    });
  }

  function sendJson(response: ServerResponse, status: number, value: unknown): void {
    const body = JSON.stringify(value);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  }

  const server: Server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/pair") {
      void readBody(request)
        .then((body) => {
          const payload: unknown = JSON.parse(body || "{}");
          if (!isRecord(payload) || typeof payload.token !== "string" ||
              (payload.label !== undefined && typeof payload.label !== "string")) {
            throw new Error("Invalid pairing request");
          }
          const result = exchangeGrant({
            grants: pruneExpired(grants),
            token: String(payload.token ?? ""),
            label: String(payload.label ?? "Paired device"),
          });
          if ("error" in result) {
            sendJson(response, 401, { error: result.error });
            return;
          }
          sessions.push(result.session);
          options.onChange?.();
          sendJson(response, 200, {
            token: result.token,
            scopes: result.session.scopes,
            expiresAt: result.session.expiresAt,
          });
        })
        .catch(() => sendJson(response, 400, { error: "bad-request" }));
      return;
    }

    const file = resolveStaticFile(options.serveDir, request.url ?? "/");
    if (!file) {
      sendJson(response, 404, { error: "not-found" });
      return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    const stream = createReadStream(file);
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  });

  const wss = new WebSocketServer({ server, path: "/rpc", maxPayload: 64 * 1024 });
  // The HTTP listener owns startup errors. ws also re-emits them; leaving its
  // error event unhandled would crash instead of rejecting startRemoteServer.
  wss.on("error", () => {});
  wss.on("connection", (socket) => {
    let session: RemoteSession | undefined;
    /*
     * The token arrives in the first frame rather than the URL: a query string
     * is written to every log and history the request passes through, and this
     * one is a bearer credential.
     */
    const authTimer = setTimeout(() => {
      if (!session) socket.close(4401, "unauthenticated");
    }, 3_000);

    let unsubscribe: (() => void) | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const disconnect = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (expiryTimer) clearTimeout(expiryTimer);
      socket.close(4401, "session expired or revoked");
    };
    const authorized = (): RemoteSession | undefined => {
      const current = sessions.find((item) => item.id === session?.id && item.expiresAt > Date.now());
      if (!current) disconnect();
      return current;
    };
    const send = (frame: unknown) => {
      if (socket.readyState === socket.OPEN && authorized()) socket.send(JSON.stringify(frame));
    };

    socket.on("message", (raw) => {
      let frame: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(String(raw));
        if (!isRecord(parsed)) throw new Error("Invalid frame");
        frame = parsed;
      } catch {
        socket.close(4400, "invalid request");
        return;
      }

      if (!session) {
        const candidate = typeof frame.token === "string"
          ? resolveSession(pruneExpired(sessions), frame.token) : undefined;
        if (!candidate) {
          socket.close(4401, "unauthenticated");
          return;
        }
        session = candidate;
        disconnectBySocket.set(socket, { sessionId: session.id, disconnect });
        expiryTimer = setTimeout(disconnect, Math.max(0, session.expiresAt - Date.now()));
        expiryTimer.unref();
        clearTimeout(authTimer);
        socket.send(JSON.stringify({ type: "ready", scopes: session.scopes }));
        unsubscribe = options.subscribe((event, payload) => {
          send({ type: "event", event, payload });
        });
        options.onChange?.();
        return;
      }

      const current = authorized();
      if (!current) return;
      if (typeof frame.channel !== "string" || !Number.isSafeInteger(frame.id) ||
          !Array.isArray(frame.args)) {
        socket.close(4400, "invalid request");
        return;
      }
      const channel = frame.channel;
      const id = frame.id;
      if (!isChannelAllowed(channel, current.scopes)) {
        send({ type: "result", id, error: `This device may not call ${channel}.` });
        return;
      }
      const args = frame.args;
      void Promise.resolve()
        .then(() => authorized() ? options.invoke(channel, args) : undefined)
        .then((result) => send({ type: "result", id, result }))
        .catch((error: unknown) =>
          send({
              type: "result",
              id,
              error: error instanceof Error ? error.message : String(error),
            }),
        );
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
      unsubscribe?.();
      sockets.delete(socket);
      disconnectBySocket.delete(socket);
      options.onChange?.();
    });
    socket.on("error", disconnect);
    sockets.add(socket);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });

  const displayHost = options.reach === "network" ? (lanAddress() ?? "127.0.0.1") : "127.0.0.1";
  const url = `http://${displayHost}:${port}`;

  return {
    url,
    port,
    pair: (scopes) => {
      const { grant, token } = issueGrant({ scopes });
      grants.push(grant);
      // The secret rides in the fragment: a fragment is never sent to the
      // server, so it stays out of logs and out of any proxy in between.
      return `${url}/#pair=${token}`;
    },
    sessions: () => {
      sessions = pruneExpired(sessions);
      return sessions.map((session) => ({ ...session }));
    },
    revoke: (id) => {
      sessions = sessions.filter((session) => session.id !== id);
      for (const connection of disconnectBySocket.values()) {
        if (connection.sessionId === id) connection.disconnect();
      }
      options.onChange?.();
    },
    stop: async () => {
      for (const socket of sockets) socket.close(1001, "server stopping");
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
