import { attentionLabel, type AttentionState, type AttentionSummary } from "@capsule/shared";

/*
 * The menu bar menu, as data. It answers "does anything need me?" first,
 * then gets the person back to work in one step. Anything else (About, the
 * Approvals view) already lives in the window and is left there.
 */

export interface TrayThread {
  id: string;
  title: string;
  projectId: string;
  state: string;
  createdAt: string;
}

export interface TrayRun {
  sessionId: string;
  createdAt: string;
  completedAt?: string | null;
}

export interface TrayMenuInput {
  summary: AttentionSummary;
  sessions: readonly TrayThread[];
  latestRuns: readonly TrayRun[];
  projectNames: ReadonlyMap<string, string>;
  companionOpen: boolean;
  /** False while the window cannot open yet (first launch, a failed start). */
  canOpenWindow: boolean;
}

export type TrayAction =
  | { kind: "open-session"; sessionId: string }
  | { kind: "new-conversation" }
  | { kind: "show" }
  | { kind: "companion"; open: boolean }
  | { kind: "settings" }
  | { kind: "quit" };

export interface TrayMenuItem {
  label?: string;
  sublabel?: string;
  type?: "separator" | "checkbox" | "submenu";
  checked?: boolean;
  enabled?: boolean;
  accelerator?: string;
  action?: TrayAction;
  submenu?: TrayMenuItem[];
}

export const ATTENTION_MARK: Record<AttentionState, string> = {
  "needs-input": "●",
  blocked: "✕",
  ready: "✓",
  running: "○",
};

/** At most this many threads in each list; the rest are a click away in the window. */
const LISTED = 8;
const RECENT = 6;

function activityOf(session: TrayThread, run: TrayRun | undefined): string {
  let latest = session.createdAt;
  for (const time of [run?.createdAt, run?.completedAt]) if (time && time > latest) latest = time;
  return latest;
}

export function trayMenuTemplate(input: TrayMenuInput): TrayMenuItem[] {
  const { summary, sessions, latestRuns, projectNames } = input;
  const project = (sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    return session ? projectNames.get(session.projectId) : undefined;
  };

  const waiting = summary.items.slice(0, LISTED).map((item): TrayMenuItem => ({
    label: `${ATTENTION_MARK[item.state]}  ${item.title}`,
    sublabel: project(item.sessionId),
    enabled: input.canOpenWindow,
    action: { kind: "open-session", sessionId: item.sessionId },
  }));
  const more = summary.items.length - waiting.length;

  // Recent work that is not already listed above, newest activity first.
  const listed = new Set(summary.items.map((item) => item.sessionId));
  const runs = new Map(latestRuns.map((run) => [run.sessionId, run]));
  const recent = sessions
    .filter((session) => session.state === "active" && !listed.has(session.id))
    .map((session) => ({ session, at: activityOf(session, runs.get(session.id)) }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT)
    .map(({ session }): TrayMenuItem => ({
      label: session.title,
      sublabel: projectNames.get(session.projectId),
      enabled: input.canOpenWindow,
      action: { kind: "open-session", sessionId: session.id },
    }));

  return [
    { label: attentionLabel(summary) ?? "Nothing needs you", enabled: false },
    ...waiting,
    ...(more > 0 ? [{ label: `${more} more in Capsule`, enabled: input.canOpenWindow, action: { kind: "show" } } satisfies TrayMenuItem] : []),
    { type: "separator" },
    { label: "New Conversation", accelerator: "CmdOrCtrl+N", enabled: input.canOpenWindow, action: { kind: "new-conversation" } },
    ...(recent.length > 0 ? [{ label: "Recent", type: "submenu", submenu: recent } satisfies TrayMenuItem] : []),
    { label: "Show Capsule", enabled: input.canOpenWindow, action: { kind: "show" } },
    { type: "separator" },
    { label: "Desktop Companion", type: "checkbox", checked: input.companionOpen, action: { kind: "companion", open: !input.companionOpen } },
    { label: "Settings…", accelerator: "CmdOrCtrl+,", enabled: input.canOpenWindow, action: { kind: "settings" } },
    { type: "separator" },
    { label: "Quit Capsule", accelerator: "CmdOrCtrl+Q", action: { kind: "quit" } },
  ];
}
