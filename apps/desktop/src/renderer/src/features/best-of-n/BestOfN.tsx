import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BestOfNCandidate, GroupComparison, ThreadGroup } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { useApplyToLocal } from "../apply/ApplyToLocal";

/*
 * Best-of-N in the renderer. The provider owns the one list of comparisons
 * so the sidebar, the composer and the Compare surface agree, and owns the
 * writes so each entry point starts, keeps and sets aside the same way.
 * A paired device reads the comparisons; `writable` is false there and no
 * write control is drawn.
 */

interface BestOfNValue {
  groups: ReadonlyMap<string, ThreadGroup>;
  writable: boolean;
  /** Send the prompt to each candidate in a new worktree thread, then show them side by side. */
  start: (input: { projectId: string; prompt: string; candidates: BestOfNCandidate[]; replaceSessionId?: string }) => Promise<boolean>;
  keep: (group: ThreadGroup, sessionId: string) => Promise<void>;
  setAside: (group: ThreadGroup, count: number) => void;
  /** Select a candidate (the kept one, else the first) and open Compare beside it. */
  openCompare: (group: ThreadGroup, sessionId?: string) => void;
  /** Bumped by every write here, so an open comparison reads again. */
  revision: number;
}

const BestOfNContext = createContext<BestOfNValue>({
  groups: new Map(), writable: false, start: async () => false, keep: async () => undefined, setAside: () => undefined, openCompare: () => undefined, revision: 0,
});

export function useBestOfN(): BestOfNValue {
  return useContext(BestOfNContext);
}

export function BestOfNProvider({ children }: { children: ReactNode }) {
  const { api, sessions, attachments, removeAttachment, setDraft, settings, setProjectId, setView, openInspector, refresh, setNotice, setConfirm } = useWorkspace();
  const applyToLocal = useApplyToLocal();
  const [groups, setGroups] = useState<ThreadGroup[]>([]);
  const [revision, setRevision] = useState(0);
  const writable = api.isDesktop !== false;

  /* A new candidate or a kept one changes the sessions list, which is when the groups can have changed. */
  const sessionsKey = sessions.map((session) => `${session.id}:${session.state}:${session.updatedAt}`).join("|");
  useEffect(() => {
    let current = true;
    void api.listThreadGroups?.().then((value) => { if (current) setGroups(value); }, () => undefined);
    return () => { current = false; };
  }, [api, sessionsKey, revision]);

  const openCompare = useCallback((group: ThreadGroup, sessionId?: string) => {
    const members = sessions.filter((session) => session.groupId === group.id);
    const target = sessionId ?? (members.find((session) => session.id === group.winnerSessionId && session.state === "active") ?? members.find((session) => session.state === "active") ?? members[0])?.id;
    if (target) setProjectId(group.projectId, target);
    setView("chat");
    openInspector("compare");
  }, [sessions, setProjectId, setView, openInspector]);

  const start = useCallback(async ({ replaceSessionId, ...input }: { projectId: string; prompt: string; candidates: BestOfNCandidate[]; replaceSessionId?: string }) => {
    try {
      const result = await api.startBestOfN({ ...input, ...(attachments.length ? { attachments } : {}), ...(settings?.defaultPermission ? { permissionProfile: settings.defaultPermission } : {}) });
      setDraft("");
      for (const attachment of attachments) removeAttachment(attachment.path);
      /* The untouched new conversation the prompt was written in became the comparison; it would stay behind empty. */
      if (replaceSessionId) await api.deleteSession(replaceSessionId).catch(() => undefined);
      await refresh();
      setGroups((current) => [result.group, ...current.filter((group) => group.id !== result.group.id)]);
      setProjectId(input.projectId, result.sessionIds[0]);
      setView("chat");
      openInspector("compare");
      return true;
    } catch (error) {
      setNotice(`Could not start the comparison: ${formatUserError(error)}`);
      return false;
    }
  }, [api, attachments, removeAttachment, setDraft, settings?.defaultPermission, refresh, setProjectId, setView, openInspector, setNotice]);

  const keep = useCallback(async (group: ThreadGroup, sessionId: string) => {
    const session = sessions.find((item) => item.id === sessionId);
    try {
      const result = await api.keepCandidate(group.id, sessionId);
      if (session) applyToLocal.showOutcome(session, result);
      else if (!result.applied) setNotice(`Could not keep this one: ${result.detail ?? "nothing was applied."}`);
    } catch (error) {
      setNotice(`Could not keep this one: ${formatUserError(error)}`);
    } finally {
      setRevision((value) => value + 1);
    }
  }, [api, sessions, applyToLocal, setNotice]);

  const setAside = useCallback((group: ThreadGroup, count: number) => {
    setConfirm({
      title: `Set aside ${count === 1 ? "the other candidate" : `the other ${count} candidates`}?`,
      detail: `${count === 1 ? "Its thread is" : "Their threads are"} archived and ${count === 1 ? "its worktree is" : "their worktrees are"} removed from disk, with the files saved first. Restore a thread from the archive to bring its worktree back.`,
      confirmLabel: "Set aside",
      onConfirm: () => {
        setConfirm(undefined);
        void api.setAsideCandidates(group.id).then(async (result) => {
          await refresh();
          if (result.failed.length) setNotice(`${result.failed.length === 1 ? "One candidate was" : `${result.failed.length} candidates were`} kept: ${result.failed[0]!.reason}`);
        }, (error) => setNotice(`Could not set the others aside: ${formatUserError(error)}`)).finally(() => setRevision((value) => value + 1));
      },
    });
  }, [api, refresh, setConfirm, setNotice]);

  const value = useMemo<BestOfNValue>(() => ({
    groups: new Map(groups.map((group) => [group.id, group])), writable, start, keep, setAside, openCompare, revision,
  }), [groups, writable, start, keep, setAside, openCompare, revision]);

  return <BestOfNContext.Provider value={value}>{children}</BestOfNContext.Provider>;
}

/** One group's comparison, read again whenever a candidate's turn moves or a write lands. */
export function useComparison(groupId: string | undefined): { comparison?: GroupComparison; error?: string; loading: boolean } {
  const { api, sessions } = useWorkspace();
  const { revision } = useBestOfN();
  const [state, setState] = useState<{ groupId: string; comparison?: GroupComparison; error?: string }>();
  const [tick, setTick] = useState(0);
  const memberKey = sessions.filter((session) => session.groupId === groupId).map((session) => `${session.id}:${session.state}:${session.updatedAt}`).join("|");

  useEffect(() => {
    if (!groupId) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /* Run events arrive in bursts while agents work; one read per burst is enough. */
    const unsubscribe = api.on("run", () => {
      clearTimeout(timer);
      timer = setTimeout(() => setTick((value) => value + 1), 400);
    });
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [api, groupId]);

  /*
   * A read takes a couple of seconds (a Git diff per worktree) while threads
   * update several times a second during a run. Cancelling the read on each
   * update left Compare loading for as long as agents worked, so every read
   * lands unless a newer one already has.
   */
  const issued = useRef(0);
  const applied = useRef(0);
  useEffect(() => {
    if (!groupId) return;
    const seq = ++issued.current;
    const land = (next: { groupId: string; comparison?: GroupComparison; error?: string }) => {
      if (seq < applied.current) return;
      applied.current = seq;
      setState(next);
    };
    void api.compareThreadGroup(groupId).then(
      (comparison) => land({ groupId, comparison }),
      (error) => land({ groupId, error: formatUserError(error) }),
    );
  }, [api, groupId, memberKey, revision, tick]);

  const known = state?.groupId === groupId ? state : undefined;
  return { comparison: known?.comparison, error: known?.error, loading: Boolean(groupId) && !known };
}
