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
  it("does not require a Gateway for direct mode but still checks login and binary", () => {
    const direct = (readiness: HarnessStatus["readiness"]) => ({ ...harness(readiness), runtimeRoute: "direct" as const });
    expect(harnessPreflightReason({ harness: direct("ready"), connected: false, folder: "/x", live: false })).toBeUndefined();
    expect(harnessPreflightReason({ harness: direct("needs_login"), connected: false, folder: "/x", live: false })).toBe("status: needs_login");
    expect(harnessPreflightReason({ harness: direct("missing_cli"), connected: false, folder: "/x", live: false })).toBe("status: missing_cli");
  });
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
