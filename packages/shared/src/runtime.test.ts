import { describe, expect, it } from "vitest";
import {
  applyAgentInstructionHints,
  applyBranchPrefix,
  classifySessionFromRun,
  DEFAULT_CAPSULE_SETTINGS,
  normalizeCapsuleSettings,
  pullRequestWatchEnabled,
  sanitizeFontName,
  shouldArchiveInactiveSession,
} from "./runtime.js";

describe("normalizeCapsuleSettings", () => {
  it("fills configuration defaults without dropping false flags", () => {
    const settings = normalizeCapsuleSettings({
      notifyRunComplete: false,
      showMenuBarExtra: false,
      keepAwakeWhileRunning: true,
      webAccess: "off",
      sandbox: "strict",
      outputDetail: "verbose",
      transcriptSize: "l",
      transcriptWidth: "narrow",
      customCodeFont: "JetBrains Mono",
      branchPrefix: "capsule",
      gitForceWithLease: true,
      prDraft: true,
      prMergeMethod: "rebase",
      commitInstructions: "Use the conventional commit format.",
    });
    expect(settings.notifyRunComplete).toBe(false);
    expect(settings.showMenuBarExtra).toBe(false);
    expect(settings.keepAwakeWhileRunning).toBe(true);
    expect(settings.notifyApprovals).toBe(true);
    expect(settings.webAccess).toBe("off");
    expect(settings.sandbox).toBe("strict");
    expect(settings.customCodeFont).toBe("JetBrains Mono");
    expect(settings.branchPrefix).toBe("capsule");
    expect(settings.transcriptSize).toBe("l");
    expect(settings.gitForceWithLease).toBe(true);
    expect(settings.prDraft).toBe(true);
    expect(settings.prMergeMethod).toBe("rebase");
    expect(settings.commitInstructions).toBe("Use the conventional commit format.");
  });

  it("keeps existing defaults when a field is omitted", () => {
    expect(normalizeCapsuleSettings({}).webAccess).toBe(DEFAULT_CAPSULE_SETTINGS.webAccess);
    expect(normalizeCapsuleSettings({}).reasoningSummary).toBe("visible");
    expect(normalizeCapsuleSettings({}).prMergeMethod).toBe("squash");
    expect(pullRequestWatchEnabled(DEFAULT_CAPSULE_SETTINGS)).toBe(false);
    expect(pullRequestWatchEnabled(normalizeCapsuleSettings({ prWatchAndFix: true }))).toBe(true);
  });
});

describe("font and branch helpers", () => {
  it("accepts a real font name and rejects junk", () => {
    expect(sanitizeFontName("JetBrains Mono")).toBe("JetBrains Mono");
    expect(sanitizeFontName("  Menlo ")).toBe("Menlo");
    expect(sanitizeFontName("url(evil)")).toBeUndefined();
    expect(sanitizeFontName("")).toBeUndefined();
  });

  it("prefixes a branch once", () => {
    expect(applyBranchPrefix("capsule", "fix-login")).toBe("capsule/fix-login");
    expect(applyBranchPrefix("capsule", "capsule/fix-login")).toBe("capsule/fix-login");
    expect(applyBranchPrefix("", "main")).toBe("main");
  });
});

describe("agent instruction hints", () => {
  it("leaves standard settings untouched", () => {
    expect(applyAgentInstructionHints("Review this", DEFAULT_CAPSULE_SETTINGS)).toBe("Review this");
  });

  it("includes commit guidance when set", () => {
    const settings = normalizeCapsuleSettings({
      commitInstructions: "Use the conventional commit format.",
    });
    expect(applyAgentInstructionHints("Ship it", settings)).toContain("conventional commit");
  });

  it("appends concise and no-web instructions to the runtime prompt only", () => {
    const settings = normalizeCapsuleSettings({ outputDetail: "concise", webAccess: "off" });
    const next = applyAgentInstructionHints("Review this", settings);
    expect(next).toContain("Review this");
    expect(next).toContain("Keep the reply concise");
    expect(next).toContain("Do not use web search");
  });
});

describe("session classification and archive", () => {
  it("maps run status to blocked or done", () => {
    expect(classifySessionFromRun({ status: "approval_required" })).toBe("blocked");
    expect(classifySessionFromRun({ status: "failed" })).toBe("blocked");
    expect(classifySessionFromRun({ status: "completed" })).toBe("done");
    expect(classifySessionFromRun({ status: "running" })).toBeUndefined();
  });

  it("archives idle threads past the cutoff and keeps live work", () => {
    const now = Date.parse("2026-08-26T12:00:00.000Z");
    expect(
      shouldArchiveInactiveSession({
        state: "active",
        updatedAt: "2026-08-20T12:00:00.000Z",
        liveHarness: false,
        hasActiveRun: false,
        cutoffMs: 86_400_000,
        now,
      }),
    ).toBe(true);
    expect(
      shouldArchiveInactiveSession({
        state: "active",
        pinned: true,
        updatedAt: "2026-08-20T12:00:00.000Z",
        liveHarness: false,
        hasActiveRun: false,
        cutoffMs: 86_400_000,
        now,
      }),
    ).toBe(false);
    expect(
      shouldArchiveInactiveSession({
        state: "active",
        updatedAt: "2026-08-20T12:00:00.000Z",
        liveHarness: true,
        hasActiveRun: false,
        cutoffMs: 86_400_000,
        now,
      }),
    ).toBe(false);
  });
});
