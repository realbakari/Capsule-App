import type { CapsuleApi } from "../../../preload/index";

/*
 * The same app, driven from a paired browser.
 *
 * The renderer talks to one object — the preload bridge — so a device that
 * cannot have a preload gets the same shape over a socket instead. Anything
 * the paired session is not allowed to call comes back as an error from the
 * server rather than being hidden here: the scope is enforced where it can be
 * trusted, not in the client asking.
 */

const PAIR_PREFIX = "#pair=";
const TOKEN_KEY = "capsule.remote.token";

/** The one-time token from a pairing link, if this page was opened with one. */
export function readPairingToken(hash: string): string | undefined {
  if (!hash.startsWith(PAIR_PREFIX)) return undefined;
  const token = hash.slice(PAIR_PREFIX.length).trim();
  return token || undefined;
}

async function exchange(token: string): Promise<string | undefined> {
  const response = await fetch("/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, label: navigator.userAgent.slice(0, 60) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("This pairing link expired or was already used. Create a new link in Capsule’s web access settings on the host computer.");
  const body = (await response.json()) as { token?: string };
  if (typeof body.token !== "string" || !body.token) throw new Error("The host did not return a pairing session. Create a new link on the host computer.");
  return body.token;
}

/** Whether this page is a paired browser rather than the desktop window. */
export async function resolveRemoteToken(): Promise<string | undefined> {
  const pairing = readPairingToken(window.location.hash);
  if (pairing) {
    // The link is spent either way; drop it from the address bar so a reload
    // does not retry a token that can no longer work.
    history.replaceState(null, "", window.location.pathname);
    const token = await exchange(pairing);
    if (token) {
      try {
        sessionStorage.setItem(TOKEN_KEY, token);
      } catch {
        // Session-only storage is a convenience; the socket still works.
      }
      return token;
    }
    return undefined;
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** A CapsuleApi backed by the paired socket. */
export function createRemoteBridge(token: string): CapsuleApi {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let socket: WebSocket | undefined;
  let queue: string[] = [];
  let ready = false;
  let control = false;
  let authError: string | undefined;
  let failures = 0;
  let handshake: ReturnType<typeof setTimeout> | undefined;

  function disconnect(connection: WebSocket, message = "Disconnected from Capsule. Check the result before retrying an action.", retry = true): void {
    if (socket !== connection) return;
    clearTimeout(handshake);
    ready = false;
    control = false;
    socket = undefined;
    // Rejected work has no owner waiting for its result. Never replay it on a
    // later connection: it may create another turn or repeat a file write.
    queue = [];
    for (const waiting of pending.values()) waiting.reject(new Error(message));
    pending.clear();
    for (const listener of listeners.get("connection") ?? []) listener({ state: "disconnected" });
    if (retry) setTimeout(connect, Math.min(30_000, 1_500 * 2 ** Math.min(failures++, 5)));
  }

  function sendFrame(connection: WebSocket, message: string) {
    try { connection.send(message); }
    catch {
      disconnect(connection);
      connection.close();
    }
  }

  function connect(): void {
    const url = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/rpc`;
    const connection = new WebSocket(url);
    socket = connection;
    ready = false;
    handshake = setTimeout(() => {
      disconnect(connection, "The Capsule host did not finish connecting. Check that it is running and reachable.");
      connection.close();
    }, 10_000);
    connection.addEventListener("open", () => {
      if (socket === connection) sendFrame(connection, JSON.stringify({ token }));
    });
    connection.addEventListener("message", (event) => {
      if (socket !== connection) return;
      let frame: {
        type?: string;
        id?: number;
        result?: unknown;
        error?: string;
        event?: string;
        payload?: unknown;
        scopes?: string[];
      };
      try {
        const parsed: unknown = JSON.parse(String(event.data));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        frame = parsed as typeof frame;
      } catch {
        disconnect(connection, "Capsule sent an unreadable response. Check the result before retrying an action.");
        connection.close();
        return;
      }
      if (frame.type === "ready") {
        clearTimeout(handshake); failures = 0;
        control = Array.isArray(frame.scopes) && frame.scopes.includes("control");
        ready = true;
        const messages = queue;
        queue = [];
        for (const message of messages) {
          if (socket !== connection) break;
          sendFrame(connection, message);
        }
        // Events missed during disconnection require a fresh read, not replayed writes.
        for (const listener of listeners.get("connection") ?? []) listener({ state: "connected" });
        return;
      }
      if (frame.type === "event" && frame.event) {
        for (const listener of listeners.get(frame.event) ?? []) listener(frame.payload);
        return;
      }
      if (frame.type === "result" && typeof frame.id === "number") {
        const waiting = pending.get(frame.id);
        pending.delete(frame.id);
        if (!waiting) return;
        if (frame.error) waiting.reject(new Error(frame.error));
        else waiting.resolve(frame.result);
      }
    });
    connection.addEventListener("close", (event) => {
      if (socket !== connection) return;
      if (event.code === 4401) {
        authError = "This pairing expired or was revoked. Create a new pairing link on the Capsule host.";
        try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* No storage in restricted browsers. */ }
        disconnect(connection, authError, false);
      } else disconnect(connection);
    });
  }
  connect();

  function call(channel: string, args: unknown[]): Promise<unknown> {
    if (authError) return Promise.reject(new Error(authError));
    if (pending.size >= 64) return Promise.reject(new Error("Too many pending requests. Wait for the connection to recover."));
    const id = nextId++;
    const message = JSON.stringify({ id, channel, args });
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    if (ready && socket?.readyState === WebSocket.OPEN) sendFrame(socket, message);
    else queue.push(message);
    return promise;
  }

  /*
   * The bridge's surface is one call shape, so it is built rather than
   * written out: a hand-maintained copy of a hundred method names would drift
   * from the preload the day either changed.
   */
  const bridge = new Proxy(
    {
      homeDir: "",
      isDesktop: false,
      get remoteMode() { return !ready ? "connecting" : control ? "control" : "read"; },
      get remoteError() { return authError; },
      getPathForFile: () => { throw new Error("File attachments are available in the desktop app, not the browser workspace."); },
      on: (channel: string, handler: (payload: unknown) => void) => {
        const set = listeners.get(channel) ?? new Set();
        set.add(handler);
        listeners.set(channel, set);
        return () => set.delete(handler);
      },
    } as Record<string, unknown>,
    {
      get(target, property) {
        if (property in target) return target[property as string];
        if (typeof property !== "string") return undefined;
        return (...args: unknown[]) => call(property, args);
      },
    },
  );
  return bridge as unknown as CapsuleApi;
}
