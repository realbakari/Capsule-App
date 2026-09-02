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
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { token?: string };
  return body.token;
}

/** Whether this page is a paired browser rather than the desktop window. */
export async function resolveRemoteToken(): Promise<string | undefined> {
  const pairing = readPairingToken(window.location.hash);
  if (pairing) {
    const token = await exchange(pairing);
    // The link is spent either way; drop it from the address bar so a reload
    // does not retry a token that can no longer work.
    history.replaceState(null, "", window.location.pathname);
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

  function connect(): void {
    const url = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/rpc`;
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      socket?.send(JSON.stringify({ token }));
    });
    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as {
        type?: string;
        id?: number;
        result?: unknown;
        error?: string;
        event?: string;
        payload?: unknown;
        scopes?: string[];
      };
      if (frame.type === "ready") {
        for (const message of queue) socket?.send(message);
        queue = [];
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
    socket.addEventListener("close", () => {
      // Every call still waiting has no answer coming.
      for (const waiting of pending.values()) waiting.reject(new Error("Disconnected from Capsule."));
      pending.clear();
      socket = undefined;
      setTimeout(connect, 1_500);
    });
  }
  connect();

  function call(channel: string, args: unknown[]): Promise<unknown> {
    const id = nextId++;
    const message = JSON.stringify({ id, channel, args });
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    if (socket?.readyState === WebSocket.OPEN) socket.send(message);
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
