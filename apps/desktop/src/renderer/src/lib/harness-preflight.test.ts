import { describe, expect, it } from "vitest";
import type { HarnessStatus, SessionRef } from "@capsule/shared";
import { agentSetupNotice, harnessPreflightReason, quotedCommand } from "./harness-preflight";

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
  it("allows a saved direct session to resume without the new default Gateway", () => {
    const selected = { ...harness("gateway_offline"), id: "grok" as const, runtimeRoute: "openclaw" as const };
    const session = { directSession: { harnessId: "grok", sessionId: "native" } } as SessionRef;
    expect(harnessPreflightReason({ harness: selected, session, connected: false, folder: "/x", live: false })).toBeUndefined();
    expect(harnessPreflightReason({ harness: harness("gateway_offline"), session, connected: false, folder: "/x", live: false })).toMatch(/Gateway/);
  });
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

describe("agent setup notice", () => {
  const signedOut = { ...harness("needs_login"), runtimeRoute: "direct" as const, loginHint: "Run `codex login`", loginState: "logged_out" as const, detail: "Codex is not signed in. Run `codex login`." };
  it("splits a signed-out agent into a title and the command, without backticks", () => {
    expect(agentSetupNotice(signedOut, signedOut.detail)).toEqual({ kind: "sign-in", title: "Codex isn't signed in", command: "codex login" });
  });
  it("reads the command out of a longer hint", () => {
    expect(quotedCommand("Run `claude auth login` in a terminal")).toBe("claude auth login");
    expect(quotedCommand("Sign in to its CLI")).toBeUndefined();
  });
  it("offers no command when the config is broken, and the install hint when the CLI is missing", () => {
    const broken = { ...signedOut, loginState: "config_invalid" as const };
    expect(agentSetupNotice(broken, broken.detail)).toEqual({ kind: "config", title: "Codex's settings could not be read", detail: "Fix its config file, then check again." });
    const missing = { ...harness("missing_cli"), detail: "Install the Codex CLI so codex is on PATH, then run `codex login`." };
    expect(agentSetupNotice(missing, missing.detail)).toEqual({ kind: "install", title: "Codex isn't installed", detail: "Install the Codex CLI so codex is on PATH, then run codex login." });
  });
  it("leaves other reasons, such as a paused conversation, to the plain notice", () => {
    expect(agentSetupNotice(signedOut, "This conversation is paused. Resume it to continue.")).toBeUndefined();
    expect(agentSetupNotice({ ...harness("ready") }, "status: ready")).toBeUndefined();
  });
});
