import type { WebSocket } from "ws";

import { MAX_OUTBOUND_BYTES, outboundFrame } from "./outbound.js";

/*
 * A share link on the wire: one socket, one thread, read only.
 *
 * The server knows nothing about threads. Whoever starts it says what a link
 * secret is worth (`resolve`), which calls it may make (`invoke`, the one
 * allowlist), and which events concern it (`event`). The grant is looked
 * up again before every call and every event, so a revoked or expired link
 * stops working mid-conversation rather than at the next reconnect.
 */

export interface ShareViewerGrant {
  id: string;
  sessionId: string;
  /** Epoch milliseconds; absent for a link that never expires. */
  expiresAt?: number;
}

export interface ShareAccess {
  resolve: (token: string) => ShareViewerGrant | undefined;
  /** Answers a call within the grant, or throws a refusal. Never forwards blindly. */
  invoke: (grant: ShareViewerGrant, channel: string, args: unknown[]) => Promise<unknown>;
  /** The payload to forward for an event, or undefined when it does not concern this grant. */
  event: (grant: ShareViewerGrant, event: string, payload: unknown) => unknown;
}

export interface ShareViewerHandle {
  grant: ShareViewerGrant;
  handle: (frame: Record<string, unknown>) => void;
  disconnect: () => void;
  close: () => void;
}

export function attachShareViewer(input: {
  socket: WebSocket;
  token: string;
  access: ShareAccess;
  subscribe: (send: (event: string, payload: unknown) => void) => () => void;
}): ShareViewerHandle | undefined {
  const { socket, token, access } = input;
  const grant = access.resolve(token);
  if (!grant) {
    socket.close(4401, "unauthenticated");
    return undefined;
  }
  let inFlight = 0;
  let unsubscribe: (() => void) | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  const close = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    if (expiryTimer) clearTimeout(expiryTimer);
  };
  const disconnect = () => {
    close();
    socket.close(4401, "share link expired or revoked");
  };
  const live = (): ShareViewerGrant | undefined => {
    const current = access.resolve(token);
    if (!current || current.id !== grant.id) {
      disconnect();
      return undefined;
    }
    return current;
  };
  const send = (frame: unknown) => {
    if (socket.readyState !== socket.OPEN || !live()) return;
    const text = outboundFrame(frame);
    if (!text || socket.bufferedAmount + Buffer.byteLength(text) > MAX_OUTBOUND_BYTES) {
      close();
      socket.close(1013, "viewer fell behind; reconnect to refresh");
      return;
    }
    socket.send(text);
  };

  if (grant.expiresAt !== undefined) {
    expiryTimer = setTimeout(disconnect, Math.max(0, Math.min(grant.expiresAt - Date.now(), 2 ** 31 - 1)));
    expiryTimer.unref();
  }
  socket.send(JSON.stringify({ type: "ready", scopes: ["read"], share: { sessionId: grant.sessionId } }));
  unsubscribe = input.subscribe((event, payload) => {
    const current = live();
    const forwarded = current ? access.event(current, event, payload) : undefined;
    if (forwarded !== undefined) send({ type: "event", event, payload: forwarded });
  });

  return {
    grant,
    disconnect,
    close,
    handle: (frame) => {
      const current = live();
      if (!current) return;
      if (typeof frame.channel !== "string" || !Number.isSafeInteger(frame.id) || !Array.isArray(frame.args)) {
        socket.close(4400, "invalid request");
        return;
      }
      const { channel, id, args } = frame as { channel: string; id: number; args: unknown[] };
      if (inFlight >= 32) {
        send({ type: "result", id, error: "Too many pending requests. Wait for them to finish." });
        return;
      }
      inFlight++;
      void Promise.resolve()
        .then(() => access.invoke(current, channel, args))
        .then((result) => send({ type: "result", id, result }))
        .catch((error: unknown) => send({ type: "result", id, error: error instanceof Error ? error.message : String(error) }))
        .finally(() => { inFlight--; });
    },
  };
}
