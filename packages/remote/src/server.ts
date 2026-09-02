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
  const relative = decodeURIComponent(requestPath.split("?")[0] ?? "/").replace(/^\/+/u, "");
  const target = path.resolve(serveDir, relative || "index.html");
  const root = path.resolve(serveDir);
  // Containment: a request for ../../etc/passwd must not escape the folder.
  const inside = target === root || target.startsWith(`${root}${path.sep}`);
  if (!inside) return undefined;
  if (existsSync(target) && statSync(target).isFile()) return target;
  const index = path.join(root, "index.html");
  return existsSync(index) ? index : undefined;
}

export async function startRemoteServer(
  options: RemoteServerOptions,
): Promise<RemoteServerHandle> {
  const grants: PairingGrant[] = [];
  let sessions: RemoteSession[] = [];
  const sockets = new Set<WebSocket>();

  const host = options.reach === "network" ? "0.0.0.0" : "127.0.0.1";

  function readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      request.on("data", (chunk) => {
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
          const payload = JSON.parse(body || "{}") as { token?: string; label?: string };
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
    createReadStream(file).pipe(response);
  });

  const wss = new WebSocketServer({ server, path: "/rpc" });
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

    socket.on("message", (raw) => {
      let frame: { id?: number; channel?: string; args?: unknown[]; token?: string };
      try {
        frame = JSON.parse(String(raw)) as typeof frame;
      } catch {
        return;
      }

      if (!session) {
        const candidate = resolveSession(pruneExpired(sessions), String(frame.token ?? ""));
        if (!candidate) {
          socket.close(4401, "unauthenticated");
          return;
        }
        session = candidate;
        clearTimeout(authTimer);
        socket.send(JSON.stringify({ type: "ready", scopes: session.scopes }));
        unsubscribe = options.subscribe((event, payload) => {
          socket.send(JSON.stringify({ type: "event", event, payload }));
        });
        options.onChange?.();
        return;
      }

      const channel = String(frame.channel ?? "");
      const id = Number(frame.id ?? 0);
      if (!isChannelAllowed(channel, session.scopes)) {
        socket.send(
          JSON.stringify({ type: "result", id, error: `This device may not call ${channel}.` }),
        );
        return;
      }
      void options
        .invoke(channel, Array.isArray(frame.args) ? frame.args : [])
        .then((result) => socket.send(JSON.stringify({ type: "result", id, result })))
        .catch((error: unknown) =>
          socket.send(
            JSON.stringify({
              type: "result",
              id,
              error: error instanceof Error ? error.message : String(error),
            }),
          ),
        );
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      unsubscribe?.();
      sockets.delete(socket);
      options.onChange?.();
    });
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
      options.onChange?.();
    },
    stop: async () => {
      for (const socket of sockets) socket.close(1001, "server stopping");
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
