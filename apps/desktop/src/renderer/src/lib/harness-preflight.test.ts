import { describe, expect, it } from "vitest";
import type { HarnessStatus } from "@capsule/shared";
import { harnessPreflightReason } from "./harness-preflight";

const harness = (readiness: HarnessStatus["readiness"]): HarnessStatus => ({
  id: "codex",
  name: "Codex",
  description: "",
  openclawAgentId: "codex",
  binaries: ["codex"],
  installHint: "",
  installUrl: "",
  readiness,
  acpxEnabled: readiness !== "missing_acpx",
  dedicatedProjectIds: [],
  liveSessionIds: [],
  detail: `status: ${readiness}`,
});

describe("harness preflight", () => {
  it("blocks missing Gateway, acpx, and login before send", () => {
    expect(harnessPreflightReason({ harness: harness("gateway_offline"), connected: false, folder: "/x", live: false })).toMatch(/Gateway/);
    expect(harnessPreflightReason({ harness: harness("missing_acpx"), connected: true, folder: "/x", live: false })).toBe("status: missing_acpx");
    expect(harnessPreflightReason({ harness: harness("needs_login"), connected: true, folder: "/x", live: false })).toBe("status: needs_login");
  });

  it("allows ready and already-live harnesses", () => {
    expect(harnessPreflightReason({ harness: harness("ready"), connected: true, folder: "/x", live: false })).toBeUndefined();
    expect(harnessPreflightReason({ harness: harness("needs_login"), connected: true, folder: "/x", live: true })).toBeUndefined();
  });
});
