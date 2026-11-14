import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { hostname, networkInterfaces } from "node:os";
import path from "node:path";

import { isChannelAllowed, type IpcScope, type RemoteViewerRecord } from "@capsule/shared";
import { WebSocketServer, type WebSocket } from "ws";
import { MAX_OUTBOUND_BYTES, outboundFrame } from "./outbound.js";
import { publicOrigin, secureControl, trustedOrigin } from "./origin.js";
import { attachShareViewer, type ShareAccess, type ShareViewerHandle } from "./share.js";
import type { TlsIdentity } from "./tls.js";

import {
  PHONE_SESSION_TTL_MS,
  exchangeGrant,
  issueGrant,
  pruneExpired,
  resolveSession,
  type PairingGrant,
  type RemoteSession,
  type RemoteTransport,
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
  /** Explicit HTTPS reverse-proxy origin. The listener must remain loopback. */
  publicUrl?: string;
  /**
   * This computer's own certificate. When present, a second listener serves
   * the same protocol over TLS for paired phones, which pin the certificate
   * from the pairing code. It binds where the plain listener binds.
   */
  tls?: TlsIdentity;
  phonePort?: number;
  /** Shown on the phone as the computer's name. */
  hostName?: string;
  /** This Capsule's version, told to paired devices so they can say "update". */
  appVersion?: string;
  /**
   * Where phone pairings outlive a restart. Only token hashes are kept, and
   * only for phone sessions: a phone shouldn't have to re-pair because the
   * computer restarted, while a browser tab's pairing already ends with the tab.
   */
  phoneSessions?: { load: () => RemoteSession[]; save: (sessions: RemoteSession[]) => void };
  /**
   * Remembers the phone port, so paired phones find the computer at the same
   * address after a restart. A taken port falls back to a new one, which
   * the phone then finds by Bonjour.
   */
  phonePortStore?: { load: () => number | undefined; save: (port: number) => void };
  /**
   * Announces the phone listener on the local network (Bonjour), so a phone
   * whose computer changed address can find it again. The phone matches the
   * advert against its pinned fingerprint and the TLS check still decides;
   * an advert is only a hint. Returns a function that withdraws it.
   */
  advertise?: (advert: { port: number; fingerprint: string; name: string }) => () => void;
  /** Calls the same handlers the desktop window calls. */
  invoke: (channel: string, args: unknown[], caller: { transport: RemoteTransport }) => Promise<unknown>;
  /** Subscribes to the events the desktop window receives. */
  subscribe: (send: (event: string, payload: unknown) => void) => () => void;
  onChange?: () => void;
  /** Read-only links to one thread. Absent: a share secret is refused like any unknown token. */
  share?: ShareAccess;
  /** The thread a paired device's call shows it reading, for presence. */
  viewing?: (channel: string, args: unknown[]) => string | undefined;
}

export interface RemoteServerHandle {
  url: string;
  port: number;
  controlAvailable: boolean;
  /** Whether phone pairing (pinned TLS, with control) is being served. */
  phoneAvailable: boolean;
  /**
   * Mints a single-use link. The token is only ever returned here. A phone
   * link is a `capsule://pair` code carrying the certificate fingerprint;
   * its grant can only be redeemed on the TLS listener.
   */
  pair: (scopes: IpcScope[], transport?: RemoteTransport) => string;
  sessions: () => RemoteSession[];
  revoke: (id: string) => void;
  /** Every live connection, paired or by share link, and the thread it is reading. */
  viewers: () => RemoteViewerRecord[];
  /** Disconnects every viewer holding this share grant. */
  revokeShare: (grantId: string) => void;
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
  const external = publicOrigin(options.publicUrl);
  if (external && options.reach !== "loopback") throw new Error("Use This computer with an HTTPS proxy; do not expose its plaintext listener to the network.");
  let localOrigin = "";
  let sessions: RemoteSession[] = options.tls && options.phoneSessions
    ? pruneExpired(options.phoneSessions.load()).filter((session) => session.transport === "phone")
    : [];
  const persistPhones = () => {
    if (!options.tls) return;
    options.phoneSessions?.save(pruneExpired(sessions).filter((session) => session.transport === "phone"));
  };
  const sockets = new Set<WebSocket>();
  const disconnectBySocket = new Map<WebSocket, { sessionId: string; disconnect: () => void }>();
  const shareViewers = new Map<WebSocket, ShareViewerHandle>();
  const viewers = new Map<WebSocket, RemoteViewerRecord>();
  let viewerCount = 0;

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

  /*
   * The phone listener is for native clients only. A browser always sends an
   * Origin on a cross-site request; refusing any Origin there means no web
   * page can reach it, even one a user was tricked into trusting.
   */
  const phoneHosts = (): string[] => phoneOrigin ? [new URL(phoneOrigin).host, `127.0.0.1:${phonePort}`] : [];
  const admitted = (request: IncomingMessage, transport: RemoteTransport): boolean => transport === "phone"
    ? phoneHosts().includes(request.headers.host ?? "") && request.headers.origin === undefined
    : [localOrigin, external].filter(Boolean).map((value) => new URL(value!).host).includes(request.headers.host ?? "") &&
      trustedOrigin(request.headers.origin, localOrigin, external);

  const handleRequest = (transport: RemoteTransport): RequestListener => (request, response) => {
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    if (!admitted(request, transport)) {
      sendJson(response, 403, { error: "untrusted-origin" });
      return;
    }
    if (request.method === "POST" && request.url === "/pair") {
      void readBody(request)
        .then((body) => {
          const payload: unknown = JSON.parse(body || "{}");
          if (!isRecord(payload) || typeof payload.token !== "string" ||
              (payload.label !== undefined && typeof payload.label !== "string")) {
            throw new Error("Invalid pairing request");
          }
          // Each listener redeems only its own grants. On the plain one,
          // control additionally needs loopback or the HTTPS proxy.
          const ownGrants = grants.filter((grant) => (grant.transport ?? "browser") === transport);
          const eligibleGrants = transport === "phone" ||
            secureControl(request.headers.origin, localOrigin, external, request.socket.remoteAddress)
            ? ownGrants : ownGrants.filter((grant) => !grant.scopes.includes("control"));
          const result = exchangeGrant({
            grants: pruneExpired(eligibleGrants),
            token: String(payload.token ?? ""),
            label: String(payload.label ?? "Paired device"),
          });
          if ("error" in result) {
            sendJson(response, 401, { error: result.error });
            return;
          }
          sessions.push(result.session);
          if (result.session.transport === "phone") persistPhones();
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

    if (transport === "phone") {
      // The phone speaks the protocol; it has no use for the web app.
      sendJson(response, 404, { error: "not-found" });
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
  };

  const server: Server = createServer(handleRequest("browser"));
  const phoneServer = options.tls
    ? createTlsServer({ key: options.tls.key, cert: options.tls.cert, minVersion: "TLSv1.2" }, handleRequest("phone"))
    : undefined;
  let phoneOrigin = "";
  let phonePort = 0;

  const attachSockets = (target: Server, transport: RemoteTransport) => {
  // A phone may upload a photo (≤ 3 MB, base64 in one frame); a browser never uploads.
  const wss = new WebSocketServer({ server: target, path: "/rpc", maxPayload: transport === "phone" ? 4 * 1024 * 1024 : 64 * 1024,
    verifyClient: ({ req }: { req: IncomingMessage }) => admitted(req, transport),
  });
  // The HTTP listener owns startup errors. ws also re-emits them; leaving its
  // error event unhandled would crash instead of rejecting startRemoteServer.
  wss.on("error", () => {});
  socketServers.push(wss);
  wss.on("connection", (socket, request) => {
    let inFlight = 0;
    let session: RemoteSession | undefined;
    /*
     * The token arrives in the first frame rather than the URL: a query string
     * is written to every log and history the request passes through, and this
     * one is a bearer credential.
     */
    const authTimer = setTimeout(() => {
      if (!session && !shareViewers.has(socket)) socket.close(4401, "unauthenticated");
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
      if (socket.readyState !== socket.OPEN || !authorized()) return;
      const text = outboundFrame(frame);
      if (!text || socket.bufferedAmount + Buffer.byteLength(text) > MAX_OUTBOUND_BYTES) {
        unsubscribe?.(); unsubscribe = undefined;
        socket.close(1013, "viewer fell behind; reconnect to refresh");
        return;
      }
      socket.send(text);
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

      const shared = shareViewers.get(socket);
      if (shared) {
        shared.handle(frame);
        return;
      }
      if (!session && options.share && typeof frame.share === "string") {
        clearTimeout(authTimer);
        const viewer = attachShareViewer({ socket, token: frame.share, access: options.share, subscribe: options.subscribe });
        if (!viewer) return;
        shareViewers.set(socket, viewer);
        viewers.set(socket, { id: `viewer_${++viewerCount}`, access: "share", label: "Share link", since: Date.now(), sessionId: viewer.grant.sessionId });
        options.onChange?.();
        return;
      }

      if (!session) {
        const candidate = typeof frame.token === "string"
          ? resolveSession(pruneExpired(sessions), frame.token) : undefined;
        // A session is used on the listener it was paired through, and
        // nowhere else: a phone's control token never crosses plain HTTP.
        if (!candidate || (candidate.transport ?? "browser") !== transport ||
            transport === "browser" && candidate.scopes.includes("control") &&
            !secureControl(request.headers.origin, localOrigin, external, request.socket.remoteAddress)) {
          socket.close(4401, "unauthenticated");
          return;
        }
        session = candidate;
        // Each phone connection renews its thirty days.
        if (transport === "phone") {
          candidate.expiresAt = Date.now() + PHONE_SESSION_TTL_MS;
          persistPhones();
        }
        disconnectBySocket.set(socket, { sessionId: session.id, disconnect });
        viewers.set(socket, { id: `viewer_${++viewerCount}`, access: "paired", label: session.label, since: Date.now() });
        // setTimeout holds at most ~24.8 days; a longer delay fires at once.
        // Re-arm in chunks, reading the expiry fresh each time (it renews).
        const armExpiry = () => {
          const remaining = (session?.expiresAt ?? 0) - Date.now();
          if (remaining <= 0) { disconnect(); return; }
          expiryTimer = setTimeout(armExpiry, Math.min(remaining, MAX_TIMER_MS));
          expiryTimer.unref();
        };
        armExpiry();
        clearTimeout(authTimer);
        socket.send(JSON.stringify({ type: "ready", scopes: session.scopes, expiresAt: session.expiresAt,
          protocol: REMOTE_PROTOCOL, ...(options.appVersion ? { version: options.appVersion } : {}) }));
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
      const viewed = options.viewing?.(channel, args);
      const viewer = viewers.get(socket);
      if (viewed && viewer && viewer.sessionId !== viewed) {
        viewer.sessionId = viewed;
        options.onChange?.();
      }
      if (inFlight >= 32) {
        send({ type: "result", id, error: "Too many pending requests. Wait for them to finish." });
        return;
      }
      inFlight++;
      void Promise.resolve()
        .then(() => authorized() ? options.invoke(channel, args, { transport }) : undefined)
        .then((result) => send({ type: "result", id, result }))
        .catch((error: unknown) =>
          send({
              type: "result",
              id,
              error: error instanceof Error ? error.message : String(error),
            }),
        ).finally(() => { inFlight--; });
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (expiryTimer) clearTimeout(expiryTimer);
      unsubscribe?.();
      sockets.delete(socket);
      disconnectBySocket.delete(socket);
      shareViewers.get(socket)?.close();
      shareViewers.delete(socket);
      viewers.delete(socket);
      options.onChange?.();
    });
    socket.on("error", disconnect);
    sockets.add(socket);
  });
  };
  const socketServers: WebSocketServer[] = [];
  attachSockets(server, "browser");
  if (phoneServer) attachSockets(phoneServer, "phone");

  const listen = (target: Server, port: number | undefined) => new Promise<number>((resolve, reject) => {
    target.once("error", reject);
    target.listen(port ?? 0, host, () => {
      const address = target.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  const port = await listen(server, options.port);
  if (phoneServer) {
    try {
      const preferred = options.phonePort ?? options.phonePortStore?.load();
      try {
        phonePort = await listen(phoneServer, preferred);
      } catch (error) {
        // Only an explicit port is worth failing over; a remembered one that
        // is now taken gives way to a fresh one.
        if (options.phonePort !== undefined || preferred === undefined ||
            (error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
        phonePort = await listen(phoneServer, undefined);
      }
      options.phonePortStore?.save(phonePort);
    } catch (error) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    }
  }

  const displayHost = options.reach === "network" ? (lanAddress() ?? "127.0.0.1") : "127.0.0.1";
  const url = `http://${displayHost}:${port}`;
  localOrigin = url;
  if (phoneServer) phoneOrigin = `https://${displayHost}:${phonePort}`;
  const computerName = (options.hostName ?? hostname()).replace(/\.local$/u, "").slice(0, 60) || "Capsule";
  // Only on This network: a loopback listener can't be reached from a phone.
  const withdrawAdvert = phoneServer && options.reach === "network" && options.advertise
    ? options.advertise({ port: phonePort, fingerprint: options.tls!.fingerprint, name: computerName })
    : undefined;

  return {
    url: external ?? url,
    port,
    controlAvailable: options.reach === "loopback",
    phoneAvailable: Boolean(phoneServer),
    pair: (scopes, transport = "browser") => {
      if (scopes.some((scope) => scope !== "read" && scope !== "control")) throw new Error("Unsupported remote scope.");
      if (transport === "phone" && !phoneServer) throw new Error("Phone pairing is not available.");
      if (transport === "browser" && scopes.includes("control") && options.reach !== "loopback") throw new Error("Control requires a loopback connection or an HTTPS proxy.");
      const active = pruneExpired(grants).filter((grant) => !grant.consumedAt);
      grants.splice(0, grants.length, ...active.slice(-63));
      const { grant, token } = issueGrant({ scopes, transport });
      grants.push(grant);
      if (transport === "phone") {
        // Everything the phone needs to find this computer and know it is
        // this one: where to connect, and the certificate it must present.
        const query = new URLSearchParams({ host: displayHost, port: String(phonePort), fp: options.tls!.fingerprint, token, name: computerName });
        return `capsule://pair?${query.toString()}`;
      }
      // The secret rides in the fragment: a fragment is never sent to the
      // server, so it stays out of logs and out of any proxy in between.
      return `${external ?? url}/#pair=${token}`;
    },
    sessions: () => {
      sessions = pruneExpired(sessions);
      return sessions.map((session) => ({ ...session }));
    },
    revoke: (id) => {
      sessions = sessions.filter((session) => session.id !== id);
      persistPhones();
      for (const connection of disconnectBySocket.values()) {
        if (connection.sessionId === id) connection.disconnect();
      }
      options.onChange?.();
    },
    viewers: () => [...viewers.values()].map((viewer) => ({ ...viewer })),
    revokeShare: (grantId) => {
      for (const viewer of shareViewers.values()) {
        if (viewer.grant.id === grantId) viewer.disconnect();
      }
    },
    stop: async () => {
      withdrawAdvert?.();
      for (const socket of sockets) socket.close(1001, "server stopping");
      for (const wss of socketServers) wss.close();
      await Promise.all([server, phoneServer].filter((target): target is Server => Boolean(target))
        .map((target) => new Promise<void>((resolve) => target.close(() => resolve()))));
    },
  };
}

/**
 * The remote protocol revision. Bump it when a paired client needs to know
 * the computer behaves differently (a new required field, a changed reply).
 */
export const REMOTE_PROTOCOL = 1;

/** The longest delay setTimeout accepts (2^31 − 1 ms). */
const MAX_TIMER_MS = 2_147_483_647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
