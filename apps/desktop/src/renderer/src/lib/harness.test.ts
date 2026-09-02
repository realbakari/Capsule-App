import { describe, expect, it } from "vitest";
import type { HarnessStatus } from "@capsule/shared";

import { agentPickerDetail, agentSwitchNotice, harnessReadinessLabel } from "./harness";

function harness(readiness: HarnessStatus["readiness"]): HarnessStatus {
  return {
    id: "claude",
    name: "Claude Code",
    description: "",
    openclawAgentId: "claude",
    binaries: ["claude"],
    installHint: "",
    installUrl: "",
    detail: "Detected /opt/homebrew/bin/claude. Dedicate it or spawn a session.",
    readiness,
    acpxEnabled: true,
    dedicatedProjectIds: [],
    liveSessionIds: [],
  };
}

describe("agentPickerDetail", () => {
  it("says what the agent is, not how it was installed", () => {
    expect(agentPickerDetail({ harness: harness("ready") })).toBe("Ready");
    expect(agentPickerDetail({ harness: harness("missing_cli") })).toBe("Not installed on this Mac");
  });

  it("marks the agent the thread is already running", () => {
    expect(agentPickerDetail({ harness: harness("running"), live: true })).toBe("Running this thread");
  });

  it("falls back to the agent's own description when it is not a harness", () => {
    expect(agentPickerDetail({ description: "OpenClaw agent" })).toBe("OpenClaw agent");
  });
});

describe("harnessReadinessLabel", () => {
  it("says the situation rather than the name of the check", () => {
    expect(harnessReadinessLabel("missing_cli")).toBe("Not installed on this Mac");
    expect(harnessReadinessLabel("needs_login")).toBe("Signed out");
    expect(harnessReadinessLabel("dedicated")).toBe("Ready · project default");
  });
});

describe("agentSwitchNotice", () => {
  it("says the running session closes before the new agent starts", () => {
    expect(agentSwitchNotice({ fromName: "Claude Code", toName: "Codex", live: true })).toBe(
      "Sending closes the Claude Code session and starts Codex for this thread.",
    );
  });

  it("stays quiet when nothing is running or nothing changes", () => {
    expect(agentSwitchNotice({ fromName: "Codex", toName: "Codex", live: true })).toBeUndefined();
    expect(agentSwitchNotice({ fromName: "Claude Code", toName: "Codex", live: false })).toBeUndefined();
  });
});
