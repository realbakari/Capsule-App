import { describe, expect, it } from "vitest";
import {
  approvalNotice,
  coalesceNotices,
  desktopText,
  noticeChannels,
  runNotice,
  toastText,
  type NoticeFocus,
  type NoticeKind,
  type NoticeSettings,
} from "./notices.js";

const ALL_ON: NoticeSettings = {
  notifyRunComplete: true,
  notifyApprovals: true,
  notifyLongCommands: true,
  inAppNotifications: true,
  notificationSound: true,
  bounceDockOnAttention: true,
};

const KINDS: NoticeKind[] = ["finished", "failed", "usage-limit", "needs-approval", "question", "long-command", "snooze-ended"];

describe("which channels carry a notice", () => {
  it("says nothing about the thread you are reading", () => {
    for (const kind of KINDS) {
      expect(noticeChannels(kind, "thread", ALL_ON)).toEqual({ toast: false, desktop: false, sound: false, attention: false });
    }
  });

  it("uses a toast while you are elsewhere in the app, never a desktop notification", () => {
    for (const kind of KINDS.filter((kind) => kind !== "snooze-ended")) {
      expect(noticeChannels(kind, "app", ALL_ON)).toEqual({ toast: true, desktop: false, sound: false, attention: false });
    }
  });

  it("uses a desktop notification with sound and a bounce while the app is in the background", () => {
    expect(noticeChannels("question", "background", ALL_ON)).toEqual({ toast: false, desktop: true, sound: true, attention: true });
    expect(noticeChannels("snooze-ended", "background", ALL_ON)).toEqual({ toast: false, desktop: true, sound: true, attention: false });
  });

  it("lets each Settings switch gate only its own kinds outside the window", () => {
    const needed = { ...ALL_ON, notifyRunComplete: false, notifyLongCommands: false };
    const desktop = (kind: NoticeKind) => noticeChannels(kind, "background", needed).desktop;
    expect(KINDS.filter(desktop)).toEqual(["needs-approval", "question"]);
    // The preset that turns notifications off outside the window keeps toasts inside it.
    expect(noticeChannels("finished", "app", { ...needed, notifyApprovals: false }).toast).toBe(true);
  });

  it("turns toasts off with the in-app switch alone", () => {
    const quietApp = { ...ALL_ON, inAppNotifications: false };
    expect(noticeChannels("failed", "app", quietApp).toast).toBe(false);
    expect(noticeChannels("failed", "background", quietApp).desktop).toBe(true);
  });

  it("plays the sound and bounces only alongside a desktop notification", () => {
    const silent = { ...ALL_ON, notificationSound: false, bounceDockOnAttention: false };
    expect(noticeChannels("finished", "background", silent)).toEqual({ toast: false, desktop: true, sound: false, attention: false });
    expect(noticeChannels("finished", "background", { ...ALL_ON, notifyRunComplete: false })).toEqual({ toast: false, desktop: false, sound: false, attention: false });
  });

  it("keeps a snoozed or settled thread quiet unless it is waiting on a decision", () => {
    const focuses: NoticeFocus[] = ["app", "background"];
    for (const focus of focuses) {
      expect(noticeChannels("finished", focus, ALL_ON, true)).toEqual({ toast: false, desktop: false, sound: false, attention: false });
      expect(noticeChannels("failed", focus, ALL_ON, true)).toEqual({ toast: false, desktop: false, sound: false, attention: false });
    }
    expect(noticeChannels("question", "background", ALL_ON, true).desktop).toBe(true);
    expect(noticeChannels("needs-approval", "app", ALL_ON, true).toast).toBe(true);
  });
});

describe("what a notice says", () => {
  const now = new Date("2026-11-17T10:00:00");

  it("reads a settled run, and stays quiet about a stop", () => {
    expect(runNotice({ status: "completed" }, now)).toEqual({ kind: "finished" });
    expect(runNotice({ status: "cancelled" }, now)).toBeUndefined();
    expect(runNotice({ status: "failed", error: "\n  npm test exited with code 1\nstack…" }, now)).toEqual({ kind: "failed", detail: "npm test exited with code 1" });
    expect(runNotice({ status: "failed" }, now)).toEqual({ kind: "failed", detail: undefined });
    expect(runNotice({ status: "blocked" }, now)?.kind).toBe("failed");
  });

  it("names a usage limit and when it lifts", () => {
    const notice = runNotice({ status: "failed", error: "Usage limit reached. Try again in 2 hours." }, now);
    expect(notice?.kind).toBe("usage-limit");
    expect(notice?.detail).toMatch(/^Resets at /);
    expect(runNotice({ status: "failed", error: "rate limit exceeded" }, now)).toEqual({ kind: "usage-limit", detail: undefined });
  });

  it("tells a question from an approval", () => {
    expect(approvalNotice({ agentName: "Claude", action: "run", target: "rm -rf build", details: { questions: [{ question: "Which branch?" }] } as never }))
      .toEqual({ kind: "question", detail: "Which branch?" });
    expect(approvalNotice({ agentName: "Claude", action: "run", target: "rm -rf build" })).toEqual({ kind: "needs-approval", detail: "Claude wants to run rm -rf build" });
  });

  it("leads with the thread, in a toast and on the desktop", () => {
    const notice = { kind: "failed" as const, sessionId: "s1", threadTitle: "Fix login", project: "web", detail: "Tests failed" };
    expect(toastText(notice)).toEqual({ title: "“Fix login” failed", detail: "Tests failed" });
    expect(desktopText(notice)).toEqual({ title: "Fix login", body: "web · Failed: Tests failed" });
    expect(desktopText({ kind: "finished", threadTitle: "Fix login" })).toEqual({ title: "Fix login", body: "Finished" });
  });

  it("caps a long detail", () => {
    const notice = runNotice({ status: "failed", error: "x".repeat(400) }, now);
    expect(notice?.detail?.length).toBe(140);
  });
});

describe("a burst of notices", () => {
  it("is one notification that opens the most urgent thread", () => {
    const burst = coalesceNotices([
      { kind: "finished", sessionId: "a", threadTitle: "Docs" },
      { kind: "question", sessionId: "b", threadTitle: "Login" },
      { kind: "failed", sessionId: "c", threadTitle: "Build" },
    ]);
    expect(burst).toEqual({ title: "2 conversations need you", body: "“Login” has a question · “Build” failed · “Docs” finished", sessionId: "b" });
  });

  it("keeps each thread's latest notice, since an earlier one was answered", () => {
    expect(coalesceNotices([
      { kind: "needs-approval", sessionId: "a", threadTitle: "Login", detail: "Claude wants to run make" },
      { kind: "finished", sessionId: "a", threadTitle: "Login" },
    ])).toEqual({ title: "Login", body: "Finished", sessionId: "a" });
    expect(coalesceNotices([
      { kind: "finished", sessionId: "a", threadTitle: "Login" },
      { kind: "needs-approval", sessionId: "a", threadTitle: "Login", detail: "Claude wants to run make" },
    ])).toEqual({ title: "Login", body: "Needs your approval: Claude wants to run make", sessionId: "a" });
  });

  it("counts finishes when nothing needs you", () => {
    expect(coalesceNotices([
      { kind: "finished", sessionId: "a", threadTitle: "Docs" },
      { kind: "finished", sessionId: "b", threadTitle: "Login" },
    ])?.title).toBe("2 conversations finished");
    expect(coalesceNotices([])).toBeUndefined();
  });
});
