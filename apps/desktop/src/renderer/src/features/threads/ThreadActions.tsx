import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { Session } from "@capsule/shared";
import type { ThreadMenuState } from "../../lib/action-menu";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";

/*
 * Thread lifecycle actions shared by the sidebar row menu, the titlebar menu,
 * the palette and Conversation details, so each offers the same thing and
 * hides it the same way on a paired device that may only read.
 */

interface ThreadActionsValue {
  /** False on a paired device: every action here changes the host. */
  writable: boolean;
  menuState: (session: Session) => ThreadMenuState;
  /** Runs a lifecycle menu action; false when the action is not one of these. */
  run: (action: string, session: Session) => boolean;
  pause: (sessionId: string) => Promise<void>;
  resume: (sessionId: string) => Promise<void>;
}

const ThreadActionsContext = createContext<ThreadActionsValue>({
  writable: false,
  menuState: () => ({}),
  run: () => false,
  pause: async () => undefined,
  resume: async () => undefined,
});

export function useThreadActions(): ThreadActionsValue {
  return useContext(ThreadActionsContext);
}

export function ThreadActionsProvider({ children }: { children: ReactNode }) {
  const { api, refresh, setNotice } = useWorkspace();
  const writable = api.isDesktop !== false;

  const pause = useCallback(async (sessionId: string) => {
    try {
      await api.pauseSession(sessionId);
      setNotice("Paused. The worktree is saved and its terminals and project actions are stopped.");
    } catch (error) { setNotice(formatUserError(error)); }
    await refresh();
  }, [api, refresh, setNotice]);

  const resume = useCallback(async (sessionId: string) => {
    try {
      const result = await api.resumeSession(sessionId);
      setNotice(result.detail);
    } catch (error) { setNotice(formatUserError(error)); }
    await refresh();
  }, [api, refresh, setNotice]);

  const menuState = useCallback((session: Session): ThreadMenuState => {
    if (!writable) return {};
    return {
      ...(session.workspaceMode === "worktree" ? { pause: session.paused ? "resume" as const : "pause" as const } : {}),
    };
  }, [writable]);

  const run = useCallback((action: string, session: Session) => {
    if (action === "pause") { void pause(session.id); return true; }
    if (action === "resume") { void resume(session.id); return true; }
    return false;
  }, [pause, resume]);

  const value = useMemo(() => ({ writable, menuState, run, pause, resume }), [writable, menuState, run, pause, resume]);
  return <ThreadActionsContext.Provider value={value}>{children}</ThreadActionsContext.Provider>;
}
