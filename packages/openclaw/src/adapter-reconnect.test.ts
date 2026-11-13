import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventFrame, HelloOk } from "@openclaw/gateway-protocol/frame-guards";

type ClientOptions = {
  onHelloOk?: (hello: HelloOk) => void;
  onEvent?: (event: EventFrame) => void;
  onClose?: (code: number, reason: string) => void;
};

const gateway = vi.hoisted(() => {
  class FakeGatewayClient {
    static instances: FakeGatewayClient[] = [];
    readonly request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "sessions.create") return { key: "agent:main:dashboard:capsule" };
      if (method === "sessions.send") return { runId: "oc-run-1" };
      return {};
    });
    constructor(readonly options: ClientOptions) {
      FakeGatewayClient.instances.push(this);
    }
    start(): void {}
    stop(): void {}
    async stopAndWait(): Promise<void> {}
    subscribeCalls(): string[] {
      return this.request.mock.calls
        .filter(([method]) => method === "sessions.messages.subscribe")
        .map(([, params]) => (params as { key: string }).key);
    }
  }
  return { FakeGatewayClient };
});

vi.mock("@openclaw/gateway-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openclaw/gateway-client")>()),
  GatewayClient: gateway.FakeGatewayClient,
}));
vi.mock("./discovery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./discovery.js")>()),
  probeTcp: async () => true,
}));
vi.mock("./device-identity.js", () => ({ createGatewayHostDeps: () => ({}) }));

const { OpenClawAdapter } = await import("./adapter.js");
const { FakeGatewayClient } = gateway;
const hello = { type: "hello-ok", protocol: 4 } as unknown as HelloOk;

async function connect(adapter: InstanceType<typeof OpenClawAdapter>) {
  const before = FakeGatewayClient.instances.length;
  const connecting = adapter.connect();
  await vi.waitFor(() => expect(FakeGatewayClient.instances.length).toBe(before + 1));
  const client = FakeGatewayClient.instances.at(-1)!;
  client.options.onHelloOk?.(hello);
  await connecting;
  return client;
}

afterEach(() => {
  FakeGatewayClient.instances.length = 0;
});

describe("OpenClawAdapter across a Gateway reconnect", () => {
  it("subscribes again to every session it was watching after the socket comes back", async () => {
    const adapter = new OpenClawAdapter({ gatewayUrl: "ws://127.0.0.1:18789", token: "test" });
    const client = await connect(adapter);
    await adapter.sendMessage({ sessionId: "agent:main:dashboard:one", content: "hi" } as never);
    await adapter.sendMessage({ sessionId: "agent:main:dashboard:two", content: "hi" } as never);
    client.request.mockClear();

    client.options.onClose?.(1006, "network changed");
    expect((await adapter.getStatus()).state).toBe("disconnected");
    client.options.onHelloOk?.(hello);

    expect((await adapter.getStatus()).state).toBe("connected");
    await vi.waitFor(() =>
      expect(client.subscribeCalls().sort()).toEqual(["agent:main:dashboard:one", "agent:main:dashboard:two"]),
    );
    await adapter.disconnect();
  });

  it("ignores a late close and late events from a client it has replaced", async () => {
    const adapter = new OpenClawAdapter({ gatewayUrl: "ws://127.0.0.1:18789", token: "test" });
    const first = await connect(adapter);
    await connect(adapter);

    first.options.onClose?.(1006, "stopped");
    expect((await adapter.getStatus()).state).toBe("connected");

    const replies: unknown[] = [];
    adapter.onAcpReply((reply) => replies.push(reply));
    first.options.onEvent?.({
      type: "event",
      event: "session.message",
      payload: { sessionKey: "agent:main:dashboard:one", message: { role: "assistant", content: "stale" } },
    } as EventFrame);
    expect(replies).toEqual([]);
    await adapter.disconnect();
  });

  it("watches the same sessions on a client created by a manual reconnect", async () => {
    const adapter = new OpenClawAdapter({ gatewayUrl: "ws://127.0.0.1:18789", token: "test" });
    await connect(adapter);
    await adapter.sendMessage({ sessionId: "agent:main:dashboard:one", content: "hi" } as never);
    const second = await connect(adapter);
    await vi.waitFor(() => expect(second.subscribeCalls()).toContain("agent:main:dashboard:one"));
    await adapter.disconnect();
  });
});
