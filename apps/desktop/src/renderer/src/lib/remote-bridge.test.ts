import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRemoteBridge, readPairingToken } from "./remote-bridge";

describe("readPairingToken", () => {
  it("reads the token a pairing link carries", () => {
    expect(readPairingToken("#pair=AbC123")).toBe("AbC123");
  });

  it("ignores anything that is not one", () => {
    expect(readPairingToken("")).toBeUndefined();
    expect(readPairingToken("#pair=")).toBeUndefined();
    expect(readPairingToken("#/settings")).toBeUndefined();
    expect(readPairingToken("?pair=AbC123")).toBeUndefined();
  });
});

class TestSocket {
  static OPEN = 1;
  static connections: TestSocket[] = [];
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  handlers = new Map<string, Array<(event: { data?: string }) => void>>();
  constructor() { TestSocket.connections.push(this); }
  addEventListener(type: string, handler: (event: { data?: string }) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  send(message: string) { this.sent.push(JSON.parse(message) as Record<string, unknown>); }
  emit(type: string, data?: string) { this.handlers.get(type)?.forEach((handler) => handler({ data })); }
  open() { this.readyState = TestSocket.OPEN; this.emit("open"); }
  frame(frame: unknown) { this.emit("message", JSON.stringify(frame)); }
  close() { this.readyState = 3; this.emit("close"); }
}

describe("paired commands across disconnects", () => {
  beforeEach(() => {
    vi.useFakeTimers(); TestSocket.connections = [];
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost:3000" } });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("waits for pairing confirmation even when the socket is open", async () => {
    const bridge = createRemoteBridge("pairing-token");
    const socket = TestSocket.connections[0]!;
    socket.open();
    const request = bridge.listProjects();
    expect(socket.sent).toEqual([{ token: "pairing-token" }]);
    socket.frame({ type: "ready" });
    expect(socket.sent[1]?.channel).toBe("listProjects");
    socket.frame({ type: "result", id: socket.sent[1]?.id, result: [] });
    await expect(request).resolves.toEqual([]);
  });

  it("never replays a rejected queued write after reconnecting", async () => {
    const bridge = createRemoteBridge("pairing-token");
    const socket = TestSocket.connections[0]!;
    const rejected = expect(bridge.updateProject("p", { name: "Rejected edit" })).rejects.toThrow("Disconnected");
    socket.close(); await rejected;
    const fresh = bridge.listProjects();
    await vi.advanceTimersByTimeAsync(1500);
    const next = TestSocket.connections[1]!;
    next.open(); next.frame({ type: "ready" });
    expect(next.sent.map((frame) => frame.channel).filter(Boolean)).toEqual(["listProjects"]);
    next.frame({ type: "result", id: next.sent[1]?.id, result: [] });
    await fresh;
  });

  it("also drops an in-flight write and ignores old-socket replies", async () => {
    const bridge = createRemoteBridge("pairing-token");
    const old = TestSocket.connections[0]!;
    old.open(); old.frame({ type: "ready" });
    const rejected = expect(bridge.updateProject("p", { name: "Maybe saved" })).rejects.toThrow("Check the result");
    old.close(); await rejected;
    await vi.advanceTimersByTimeAsync(1500);
    const next = TestSocket.connections[1]!; next.open(); next.frame({ type: "ready" });
    const request = bridge.listProjects();
    const id = next.sent[1]?.id;
    old.frame({ type: "result", id, result: ["wrong"] });
    old.close();
    next.frame({ type: "result", id, result: [] });
    await expect(request).resolves.toEqual([]);
    expect(next.sent.filter((frame) => frame.channel === "updateProject")).toEqual([]);
  });

  it("reports malformed JSON as a connection failure instead of leaving requests pending", async () => {
    const bridge = createRemoteBridge("pairing-token");
    const socket = TestSocket.connections[0]!; socket.open(); socket.frame({ type: "ready" });
    const rejected = expect(bridge.listProjects()).rejects.toThrow("unreadable response");
    expect(() => socket.emit("message", '{"type":')).not.toThrow();
    await rejected;
    await vi.advanceTimersByTimeAsync(1500);
    expect(TestSocket.connections).toHaveLength(2);
  });
});
