import { describe, expect, it } from "vitest";
import { acpSpawnCommand, describeReadiness, PRESET_HARNESSES } from "./index.js";

describe("harness catalog", () => {
  it("ships Claude Code and Codex as first-class ACP targets", () => {
    expect(PRESET_HARNESSES.map((item) => item.id)).toEqual(["claude", "codex"]);
  });

  it("builds the OpenClaw ACP spawn command Buzz-style", () => {
    expect(acpSpawnCommand("claude", "/repo")).toBe(
      "/acp spawn claude --bind here --mode persistent --cwd /repo",
    );
  });

  it("asks for acpx when the CLI is present but the plugin is not", () => {
    const claude = PRESET_HARNESSES[0]!;
    const result = describeReadiness({
      preset: claude,
      binaryPath: "/usr/local/bin/claude",
      gatewayConnected: true,
      acpxEnabled: false,
      dedicated: false,
    });
    expect(result.readiness).toBe("missing_acpx");
  });
});
