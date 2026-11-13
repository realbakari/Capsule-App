import { useCallback, useEffect, useMemo, useRef } from "react";
import { isThreadUnread, threadShelf, type Run, type Session, type ThreadTriageAction } from "@capsule/shared";
import { formatUserError } from "./errors";
import { latestSidebarRuns } from "./sidebar";
import { useToasts } from "./toasts";
import { useWorkspace } from "./workspace";

type RunSummary = Pick<Run, "status" | "completedAt" | "updatedAt">;

/**
 * Where "Settle and next" goes: what wants the person most, after this one.
 *
 * A decision first, then an unread finish, then a failure, newest first in
 * each. Shelved threads are not next. Nothing waiting returns undefined and
 * the caller stays put rather than jumping somewhere arbitrary.
 */
export function nextTriageThread(
  sessions: readonly Session[],
  latest: ReadonlyMap<string, RunSummary>,
  currentId: string | undefined,
  now = Date.now(),
): Session | undefined {
  const rank = (session: Session): number | undefined => {
    const run = latest.get(session.id);
    if (run?.status === "approval_required" || run?.status === "blocked") return 0;
    if (threadShelf(session, now) !== "active") return undefined;
    if (isThreadUnread(session, run)) return run?.status === "failed" ? 2 : 1;
    return undefined;
  };
  let best: { session: Session; rank: number } | undefined;
  for (const session of sessions) {
    if (session.id === currentId || session.state !== "active") continue;
    const value = rank(session);
    if (value === undefined) continue;
    if (!best || value < best.rank || (value === best.rank && session.updatedAt > best.session.updatedAt)) best = { session, rank: value };
  }
  return best?.session;
}

/** `compact` drops "Tomorrow" for its weekday, for a sidebar row's narrow meta column. */
export function formatWakeTime(iso: string, now = new Date(), timeFormat?: "system" | "12h" | "24h", compact = false): string {
  const at = new Date(iso);
  const hour12 = timeFormat === "12h" ? true : timeFormat === "24h" ? false : undefined;
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12 });
  if (at.toDateString() === now.toDateString()) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (!compact && at.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  const withinWeek = at.getTime() - now.getTime() < 6 * 86_400_000;
  const day = at.toLocaleDateString(undefined, withinWeek ? { weekday: "short" } : { month: "short", day: "numeric" });
  return `${day} ${time}`;
}

/** The person's triage of threads, as one set of actions every surface shares. */
export function useThreadTriage() {
  const { api, sessions, projectRuns, sessionId, setProjectId, setView, setNotice, settings } = useWorkspace();
  const toasts = useToasts();
  const writable = api.isDesktop !== false;
  const latest = useMemo(() => latestSidebarRuns(projectRuns), [projectRuns]);

  const apply = useCallback(async (id: string, action: ThreadTriageAction): Promise<Session | undefined> => {
    if (!writable) return undefined;
    try {
      return await api.triageSession(id, action);
    } catch (error) {
      setNotice(formatUserError(error));
      return undefined;
    }
  }, [api, writable, setNotice]);

  const titleOf = useCallback((id: string) => sessions.find((item) => item.id === id)?.title ?? "conversation", [sessions]);

  const open = useCallback((target: Session) => {
    setProjectId(target.projectId, target.id);
    setView("chat");
  }, [setProjectId, setView]);

  const settle = useCallback(async (id: string, options: { advance?: boolean } = {}) => {
    const next = options.advance ? nextTriageThread(sessions, latest, id) : undefined;
    if (!(await apply(id, { kind: "settle" }))) return;
    toasts.show({
      key: `triage:${id}`,
      tone: "success",
      title: `Settled “${titleOf(id)}”`,
      detail: options.advance && !next ? "Nothing else is waiting for you." : undefined,
      action: { label: "Undo", undo: true, run: () => void apply(id, { kind: "unsettle" }) },
    });
    if (next) open(next);
  }, [apply, latest, open, sessions, titleOf, toasts]);

  const snooze = useCallback(async (id: string, until: Date | string) => {
    const iso = typeof until === "string" ? until : until.toISOString();
    if (!(await apply(id, { kind: "snooze", until: iso }))) return;
    toasts.show({
      key: `triage:${id}`,
      tone: "success",
      title: `Snoozed until ${formatWakeTime(iso, new Date(), settings?.timeFormat)}`,
      detail: titleOf(id),
      action: { label: "Undo", undo: true, run: () => void apply(id, { kind: "wake" }) },
    });
  }, [apply, settings?.timeFormat, titleOf, toasts]);

  return {
    writable,
    latest,
    settle,
    unsettle: (id: string) => apply(id, { kind: "unsettle" }),
    snooze,
    wake: (id: string) => apply(id, { kind: "wake" }),
    markUnread: (id: string) => apply(id, { kind: "unread" }),
    markRead: (id: string) => apply(id, { kind: "viewed" }),
    isUnread: (session: Session) => isThreadUnread(session, latest.get(session.id)),
    currentId: sessionId,
  };
}

/**
 * Marks the thread on screen read while the window has focus: on opening it,
 * on focus returning, and when one of its turns finishes in front of you.
 * A paired viewer never writes; it only reads the desktop's state.
 */
export function useMarkThreadViewed(visible: boolean) {
  const { api, session, projectRuns } = useWorkspace();
  const writable = api.isDesktop !== false;
  const run = useMemo(() => session ? latestSidebarRuns(projectRuns).get(session.id) : undefined, [projectRuns, session]);
  const latestFinish = run ? `${run.id}:${run.status}` : "";
  const sent = useRef<string>("");
  useEffect(() => {
    if (!writable || !visible || !session) return;
    const mark = () => {
      if (!document.hasFocus() || document.visibilityState !== "visible") return;
      if (!isThreadUnread(session, run)) return;
      const key = `${session.id}:${latestFinish}`;
      if (sent.current === key) return;
      sent.current = key;
      void api.triageSession(session.id, { kind: "viewed" }).catch(() => { sent.current = ""; });
    };
    mark();
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [api, latestFinish, run, session, visible, writable]);
}
