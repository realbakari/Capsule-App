import { describe, expect, it } from "vitest";
import {
  APPROVAL_PRESETS,
  approvalCarrier,
  approvalOptionDetail,
  approvalPreset,
  directApprovalDecision,
  isInsideFolder,
} from "./approval-presets.js";
import { acpxPermissionMode, HARNESS_PERMISSION_PROFILES, PRESET_HARNESSES } from "./harness.js";

describe("approval presets", () => {
  it("labels every stored profile, in Ask, Auto, Full order", () => {
    expect(APPROVAL_PRESETS.map((preset) => preset.label)).toEqual(["Ask", "Auto", "Full"]);
    expect(APPROVAL_PRESETS.map((preset) => preset.id).sort()).toEqual([...HARNESS_PERMISSION_PROFILES].sort());
  });

  it("reads an unknown or missing profile as Auto", () => {
    expect(approvalPreset(undefined).label).toBe("Auto");
    expect(approvalPreset("deny-all").label).toBe("Auto");
  });

  it("gives every harness a decision on every route", () => {
    for (const harness of PRESET_HARNESSES) {
      for (const route of ["direct", "gateway", "mock"] as const) {
        for (const preset of APPROVAL_PRESETS) {
          const carrier = approvalCarrier(preset.id, { route, harnessId: harness.id });
          expect(carrier.detail.length, `${harness.id} ${route} ${preset.label}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("says plainly that the Gateway refuses rather than asks, and that Auto runs commands there", () => {
    expect(approvalCarrier("strict", { route: "gateway", harnessId: "claude" })).toMatchObject({ carry: "approximated" });
    expect(approvalCarrier("strict", { route: "gateway" }).detail).toMatch(/refuses what needs approval/);
    expect(approvalCarrier("default", { route: "gateway" }).detail).toMatch(/commands run without asking too/);
    expect(approvalCarrier("approve-all", { route: "gateway" }).carry).toBe("enforced");
  });

  it("matches the acpx mode the Gateway is actually sent", () => {
    expect(acpxPermissionMode("strict")).toBe("deny-all");
    expect(acpxPermissionMode("default")).toBe("approve-all");
    expect(acpxPermissionMode("approve-all")).toBe("approve-all");
  });

  it("enforces direct presets for Claude Code and names its matching modes", () => {
    expect(approvalCarrier("strict", { route: "direct", harnessId: "claude" })).toMatchObject({ carry: "enforced", agentMode: "default" });
    expect(approvalCarrier("default", { route: "direct", harnessId: "claude" })).toMatchObject({ carry: "enforced", agentMode: "acceptEdits" });
    expect(approvalCarrier("approve-all", { route: "direct", harnessId: "claude" })).toMatchObject({ carry: "enforced", agentMode: "bypassPermissions" });
  });

  it("approximates Ask and Auto for Codex, whose own auto mode acts without asking", () => {
    expect(approvalCarrier("strict", { route: "direct", harnessId: "codex" })).toMatchObject({ carry: "approximated", agentMode: "read-only" });
    expect(approvalCarrier("default", { route: "direct", harnessId: "codex" }).detail).toMatch(/sandboxed commands/);
    expect(approvalCarrier("approve-all", { route: "direct", harnessId: "codex" })).toMatchObject({ carry: "enforced", agentMode: "full-access" });
  });

  it("approximates Ask and Auto for agents whose modes Capsule does not know", () => {
    const carrier = approvalCarrier("default", { route: "direct", harnessId: "grok" });
    expect(carrier.carry).toBe("approximated");
    expect(carrier.agentMode).toBeUndefined();
  });

  it("does not claim the demo runtime carries a preset", () => {
    expect(approvalCarrier("approve-all", { route: "mock" }).carry).toBe("not-carried");
    expect(approvalOptionDetail("approve-all", { route: "mock" })).toMatch(/^Nothing asks\..*Not carried here:/);
    expect(approvalOptionDetail("strict", { route: "direct", harnessId: "codex" })).toMatch(/^Every edit and command asks first\. In its own auto mode Codex/);
  });

  it("keeps an enforced row to the summary and the matching mode", () => {
    expect(approvalOptionDetail("approve-all", { route: "direct", harnessId: "claude" }))
      .toBe("Nothing asks. The agent edits and runs commands on its own. Matches the agent's bypassPermissions mode.");
  });
});

describe("direct approval decisions", () => {
  const root = "/work/app";

  it("asks for everything under Ask and allows everything under Full", () => {
    expect(directApprovalDecision("strict", { kind: "read", locations: ["/work/app/a.ts"] }, root)).toBe("ask");
    expect(directApprovalDecision("approve-all", { kind: "execute", locations: [] }, root)).toBe("allow");
    expect(directApprovalDecision("approve-all", { locations: ["/etc/hosts"] }, undefined)).toBe("allow");
  });

  it("allows reads and edits inside the workspace under Auto", () => {
    expect(directApprovalDecision("default", { kind: "read", locations: ["/work/app/src/a.ts"] }, root)).toBe("allow");
    expect(directApprovalDecision("default", { kind: "think", locations: [] }, root)).toBe("allow");
    expect(directApprovalDecision("default", { kind: "edit", locations: ["/work/app/src/a.ts", "src/b.ts"] }, root)).toBe("allow");
    expect(directApprovalDecision("default", { kind: "move", locations: ["/work/app/a", "/work/app/b"] }, root)).toBe("allow");
  });

  it("asks under Auto for commands, fetches, unknown kinds and anything outside the workspace", () => {
    expect(directApprovalDecision("default", { kind: "execute", locations: ["/work/app"] }, root)).toBe("ask");
    expect(directApprovalDecision("default", { kind: "fetch", locations: [] }, root)).toBe("ask");
    expect(directApprovalDecision("default", { locations: ["/work/app/a.ts"] }, root)).toBe("ask");
    expect(directApprovalDecision("default", { kind: "read", locations: ["/work/other/a.ts"] }, root)).toBe("ask");
    expect(directApprovalDecision("default", { kind: "edit", locations: ["/work/app/../secrets"] }, root)).toBe("ask");
    expect(directApprovalDecision("default", { kind: "edit", locations: ["/work/app/a.ts", "/tmp/x"] }, root)).toBe("ask");
  });

  it("asks under Auto for an edit that names no file, or with no workspace", () => {
    expect(directApprovalDecision("default", { kind: "edit", locations: [] }, root)).toBe("ask");
    expect(directApprovalDecision("default", { kind: "read", locations: ["/work/app/a.ts"] }, undefined)).toBe("ask");
  });
});

describe("isInsideFolder", () => {
  it("does not treat a sibling with the same prefix as inside", () => {
    expect(isInsideFolder("/work/app-old/a", "/work/app")).toBe(false);
    expect(isInsideFolder("/work/app", "/work/app/")).toBe(true);
    expect(isInsideFolder("./a/../b", "/work/app")).toBe(true);
    expect(isInsideFolder("/anything", "relative")).toBe(false);
  });
});
