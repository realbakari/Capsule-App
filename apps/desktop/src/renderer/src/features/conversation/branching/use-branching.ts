import { useCallback, useEffect, useMemo, useState } from "react";
import type { ForkBranchGroup, ForkWorkspace, RedoPoint, RestoreResult, RestoreScope } from "@capsule/shared";
import { useWorkspace } from "../../../lib/workspace";
import { formatUserError } from "../../../lib/errors";

/**
 * Restore, Redo and Fork for the open thread.
 *
 * All three change the machine, so a paired viewer never gets them: the
 * channels are writes, and the controls are not drawn there at all.
 */
/** Every mounted copy of the hook reloads when one of them changes the thread. */
const CHANGED = "capsule:branching-changed";
const announce = () => window.dispatchEvent(new Event(CHANGED));

/** The palette needs only the actions and Redo; the thread also reads its branch groups. */
export function useBranching({ withBranches = false }: { withBranches?: boolean } = {}) {
  const { api, session, sessions, runs, refresh, reloadThread, setSessionId, setNotice } = useWorkspace();
  const writable = api.isDesktop !== false;
  const sessionId = session?.id;
  const [redo, setRedo] = useState<RedoPoint>();
  const [groups, setGroups] = useState<ForkBranchGroup[]>([]);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const bump = () => setGeneration((value) => value + 1);
    window.addEventListener(CHANGED, bump);
    return () => window.removeEventListener(CHANGED, bump);
  }, []);
  const runKey = useMemo(() => runs.filter((run) => run.sessionId === sessionId).map((run) => `${run.id}:${run.status}`).join(","), [runs, sessionId]);
  const sessionKey = useMemo(() => sessions.map((item) => `${item.id}:${item.title}:${item.state}`).join(","), [sessions]);

  useEffect(() => {
    let disposed = false;
    if (!sessionId) { setRedo(undefined); setGroups([]); return; }
    if (withBranches) void api.forkBranches(sessionId).then((value) => { if (!disposed) setGroups(value); }, () => { if (!disposed) setGroups([]); });
    if (writable) void api.redoPoint(sessionId).then((value) => { if (!disposed) setRedo(value ?? undefined); }, () => { if (!disposed) setRedo(undefined); });
    return () => { disposed = true; };
  }, [api, sessionId, runKey, sessionKey, writable, generation, withBranches]);

  const settle = useCallback(async (id: string, result: RestoreResult) => {
    await refresh();
    await reloadThread(id);
    setRedo(result.ok ? result.redo : undefined);
    announce();
  }, [reloadThread, refresh]);

  const restore = useCallback(async (runId: string, scope: RestoreScope): Promise<RestoreResult> => {
    if (!sessionId) return { ok: false, detail: "Open a conversation first." };
    const result = await api.restoreToTurn({ runId, scope });
    if (result.ok) await settle(sessionId, result);
    return result;
  }, [api, sessionId, settle]);

  const redoLast = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await api.redoRestore(sessionId);
      await refresh();
      await reloadThread(sessionId);
      setRedo(undefined);
      announce();
      setNotice(result.detail);
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }, [api, reloadThread, refresh, sessionId, setNotice]);

  const fork = useCallback(async (runId: string, workspace: ForkWorkspace) => {
    if (!sessionId) return;
    try {
      const forked = await api.forkSession({ sessionId, runId, workspace });
      await refresh();
      announce();
      setSessionId(forked.id);
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }, [api, refresh, sessionId, setNotice, setSessionId]);

  return { writable, redo, groups, restore, redoLast, fork, setRedo };
}
