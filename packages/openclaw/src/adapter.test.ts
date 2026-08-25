import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OpenClawAdapter } from "./adapter.js";
import { DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT, probeTcp } from "./discovery.js";

describe("OpenClawAdapter live connect", () => {
  it("presents a device identity to a running local Gateway", async () => {
    const reachable = await probeTcp(DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT);
    if (!reachable) return;
    const adapter = new OpenClawAdapter({
      identityDir: mkdtempSync(path.join(tmpdir(), "capsule-gw-")),
      clientVersion: "0.1.0-test",
    });
    await adapter.connect();
    const status = await adapter.getStatus();
    expect(status.state).toBe("connected");
    expect(status.error).toBeUndefined();
    await adapter.disconnect();
  });
});
