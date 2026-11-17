import { useCallback, useEffect, useRef } from "react";
import { approvalNotice, noticeChannels, runNotice, threadShelf, toastText, type Notice, type Run } from "@capsule/shared";
import { settledRuns } from "../../lib/background-activity";
import { useToasts } from "../../lib/toasts";
import { useWorkspace } from "../../lib/workspace";

const TONE: Record<Notice["kind"], "info" | "success" | "error"> = {
  finished: "success",
  failed: "error",
  "usage-limit": "error",
  "needs-approval": "info",
  question: "info",
  "long-command": "info",
  "snooze-ended": "info",
};

/**
 * Another thread's news, while you are in the app: a toast you can open. The
 * toast's live region is also what a screen reader announces. With the window
 * in the background, the desktop notification carries it instead; the shared
 * notice policy decides which.
 */
export function BackgroundActivity() {
  const { api, approvals, projectRuns, sessions, sessionId, view, setProjectId, setView, settings } = useWorkspace();
  const toasts = useToasts();
  const seenRuns = useRef<Map<string, Pick<Run, "status">> | undefined>(undefined);
  const seenApprovals = useRef<Set<string> | undefined>(undefined);
  const since = useRef(new Date().toISOString());
  const mountedAt = useRef(since.current);
  const onScreen = view === "chat" ? sessionId : undefined;

  const tell = useCallback((threadId: string | undefined, notice: Pick<Notice, "kind" | "detail">) => {
    const session = sessions.find((entry) => entry.id === threadId);
    if (!session || session.state !== "active" || !settings) return;
    const focus = !document.hasFocus() ? "background" : session.id === onScreen ? "thread" : "app";
    if (!noticeChannels(notice.kind, focus, settings, threadShelf(session) !== "active").toast) return;
    const text = toastText({ ...notice, threadTitle: session.title });
    toasts.show({
      key: `activity:${session.id}`,
      tone: TONE[notice.kind],
      title: text.title,
      detail: text.detail,
      timeoutMs: notice.kind === "needs-approval" || notice.kind === "question" ? 15_000 : undefined,
      action: { label: "Open", run: () => { setProjectId(session.projectId, session.id); setView("chat"); } },
    });
  }, [onScreen, sessions, setProjectId, setView, settings, toasts]);
  // Read through a ref, so a renamed thread or a settings change is not mistaken for news.
  const tellRef = useRef(tell);
  tellRef.current = tell;

  useEffect(() => {
    const previous = seenRuns.current;
    seenRuns.current = new Map(projectRuns.map((run) => [run.id, { status: run.status }]));
    const checkpoint = since.current;
    since.current = new Date().toISOString();
    if (!previous) return;
    for (const run of settledRuns(previous, projectRuns, checkpoint)) {
      const notice = runNotice(run);
      if (notice) tellRef.current(run.sessionId, notice);
    }
  }, [projectRuns]);

  useEffect(() => {
    const pending = approvals.filter((approval) => approval.status === "pending");
    const previous = seenApprovals.current;
    seenApprovals.current = new Set(pending.map((approval) => approval.id));
    if (!previous) return;
    for (const approval of pending) {
      // The first load lists approvals already waiting; the sidebar shows those, they are not news.
      if (previous.has(approval.id) || approval.createdAt <= mountedAt.current) continue;
      tellRef.current(approval.sessionId, approvalNotice(approval));
    }
  }, [approvals]);

  useEffect(() => {
    if (typeof api.on !== "function") return undefined;
    const off = api.on("state", (payload) => {
      const event = payload as { command?: string; sessionId?: string; detail?: string } | undefined;
      if (event?.command === "long-command") tellRef.current(event.sessionId, { kind: "long-command", detail: event.detail });
    });
    return () => { off(); };
  }, [api]);

  // Opening the thread is reading the news; its toast has nothing left to say.
  useEffect(() => {
    if (onScreen) toasts.dismissKey(`activity:${onScreen}`);
  }, [onScreen, toasts]);

  return null;
}
