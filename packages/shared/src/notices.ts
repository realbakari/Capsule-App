import type { CapsuleSettings } from "./runtime.js";
import type { ApprovalRequest, Run } from "./types.js";
import { detectUsageLimit, formatResetTime } from "./usage-limit.js";

/**
 * How Capsule tells you a thread did something while you were not looking.
 *
 * One table decides it for every way out of the app, so the window, the Dock
 * and the desktop notification agree:
 *
 *   on that thread     nothing; you are reading it
 *   elsewhere in app   a toast with Open, if in-app notifications are on
 *   app in background  a desktop notification that opens the thread, with
 *                      the system sound and a Dock bounce if those are on
 *
 * The per-kind switches in Settings gate only the desktop notification. A
 * toast is the window telling you, so it follows the one in-app switch.
 */
export type NoticeKind =
  | "finished"
  | "failed"
  | "usage-limit"
  | "needs-approval"
  | "question"
  | "long-command"
  | "snooze-ended";

/** Where the person is when it happens. */
export type NoticeFocus = "thread" | "app" | "background";

export interface NoticeChannels {
  toast: boolean;
  desktop: boolean;
  /** The system sound, played by the desktop notification so Focus modes can mute it. */
  sound: boolean;
  /** Bounce the Dock icon on macOS, flash the taskbar button on Windows. */
  attention: boolean;
}

export type NoticeSettings = Pick<
  CapsuleSettings,
  "notifyRunComplete" | "notifyApprovals" | "notifyLongCommands" | "inAppNotifications" | "notificationSound" | "bounceDockOnAttention"
>;

interface NoticeRule {
  /** The Settings switch that lets this kind out of the window. */
  setting: "notifyRunComplete" | "notifyApprovals" | "notifyLongCommands";
  /** Whether the window shows it as a toast; a woken thread already reappears in the list. */
  toast: boolean;
  /** Ranks a burst: lower is more urgent. A decision outranks a stop, which outranks a finish. */
  rank: 0 | 1 | 2;
  /** What it did, after the thread's name: "“Fix login” needs your approval". */
  verb: string;
}

const RULES: Record<NoticeKind, NoticeRule> = {
  question: { setting: "notifyApprovals", toast: true, rank: 0, verb: "has a question" },
  "needs-approval": { setting: "notifyApprovals", toast: true, rank: 0, verb: "needs your approval" },
  failed: { setting: "notifyRunComplete", toast: true, rank: 1, verb: "failed" },
  "usage-limit": { setting: "notifyRunComplete", toast: true, rank: 1, verb: "hit a usage limit" },
  "long-command": { setting: "notifyLongCommands", toast: true, rank: 1, verb: "is running a long command" },
  finished: { setting: "notifyRunComplete", toast: true, rank: 2, verb: "finished" },
  "snooze-ended": { setting: "notifyRunComplete", toast: false, rank: 2, verb: "is back from snooze" },
};

/**
 * `quiet` is a snoozed or settled thread. It asked to stay out of the way, so
 * only a decision it is blocked on gets through, as in the attention summary.
 */
export function noticeChannels(kind: NoticeKind, focus: NoticeFocus, settings: NoticeSettings, quiet = false): NoticeChannels {
  const rule = RULES[kind];
  if (quiet && rule.rank > 0) return { toast: false, desktop: false, sound: false, attention: false };
  const desktop = focus === "background" && settings[rule.setting];
  return {
    toast: focus === "app" && rule.toast && settings.inAppNotifications,
    desktop,
    sound: desktop && settings.notificationSound,
    attention: desktop && settings.bounceDockOnAttention && kind !== "snooze-ended",
  };
}

/** One thing to tell, before it is shaped for a toast or a desktop notification. */
export interface Notice {
  kind: NoticeKind;
  sessionId?: string;
  threadTitle: string;
  project?: string;
  /** The specifics: the question, what wants approving, why it failed, when a limit lifts. */
  detail?: string;
}

const DETAIL_LIMIT = 140;

function firstLine(text: string | undefined): string | undefined {
  const line = text?.split("\n").map((part) => part.trim()).find(Boolean);
  if (!line) return undefined;
  return line.length > DETAIL_LIMIT ? `${line.slice(0, DETAIL_LIMIT - 1)}…` : line;
}

/** What a settled run has to say, or nothing: stopping a turn yourself is not news. */
export function runNotice(run: Pick<Run, "status" | "error">, now = new Date()): Pick<Notice, "kind" | "detail"> | undefined {
  switch (run.status) {
    case "completed":
      return { kind: "finished" };
    case "failed": {
      const limit = detectUsageLimit(run.error, now);
      if (limit.limited) return { kind: "usage-limit", detail: limit.resetsAt ? `Resets at ${formatResetTime(limit.resetsAt, now)}` : undefined };
      return { kind: "failed", detail: firstLine(run.error) };
    }
    case "blocked":
      return { kind: "failed", detail: firstLine(run.error) ?? "A rule stopped it before it ran." };
    default:
      return undefined;
  }
}

/** A pending approval is a question when the agent asked one, and an approval otherwise. */
export function approvalNotice(approval: Pick<ApprovalRequest, "agentName" | "action" | "target" | "details">): Pick<Notice, "kind" | "detail"> {
  const question = approval.details?.questions?.[0]?.question;
  if (question) return { kind: "question", detail: firstLine(question) };
  return { kind: "needs-approval", detail: firstLine(`${approval.agentName} wants to ${approval.action} ${approval.target}`.trim()) };
}

export function longCommandNotice(command: { title: string; seconds: number }): Pick<Notice, "kind" | "detail"> {
  return { kind: "long-command", detail: firstLine(`${command.title} has run for ${command.seconds} seconds without approval`) };
}

export function toastText(notice: Notice): { title: string; detail?: string } {
  return { title: `“${notice.threadTitle}” ${RULES[notice.kind].verb}`, detail: notice.detail };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The thread's name leads, because "Finished" alone does not say which of a dozen threads it was. */
export function desktopText(notice: Notice): { title: string; body: string } {
  const what = notice.detail ? `${capitalize(RULES[notice.kind].verb)}: ${notice.detail}` : capitalize(RULES[notice.kind].verb);
  return { title: notice.threadTitle, body: notice.project ? `${notice.project} · ${what}` : what };
}

/**
 * A burst of notices as one desktop notification. Five threads finishing in
 * the same second is one thing to read, not five banners. Each thread keeps
 * its latest notice, since an approval followed by a finish was answered, and
 * clicking opens the most urgent thread.
 */
export function coalesceNotices(notices: readonly Notice[]): { title: string; body: string; sessionId?: string } | undefined {
  const byThread = new Map<string, Notice>();
  notices.forEach((notice, index) => {
    const key = notice.sessionId ?? `notice:${index}`;
    byThread.delete(key);
    byThread.set(key, notice);
  });
  const ordered = [...byThread.values()].sort((left, right) => RULES[left.kind].rank - RULES[right.kind].rank);
  const [first] = ordered;
  if (!first) return undefined;
  if (ordered.length === 1) return { ...desktopText(first), sessionId: first.sessionId };
  const needYou = ordered.filter((notice) => RULES[notice.kind].rank < 2).length;
  const title = needYou > 0
    ? `${needYou} conversation${needYou === 1 ? " needs" : "s need"} you`
    : `${ordered.length} conversations finished`;
  const body = ordered.map((notice) => toastText(notice).title).join(" · ");
  return { title, body, sessionId: first.sessionId };
}
