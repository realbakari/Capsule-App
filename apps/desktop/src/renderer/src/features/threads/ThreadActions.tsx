import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { collectTags, type Session } from "@capsule/shared";
import type { ThreadMenuState } from "../../lib/action-menu";
import { formatUserError } from "../../lib/errors";
import { useModalFocus } from "../../lib/modal-focus";
import { useWorkspace } from "../../lib/workspace";
import { TagEditor } from "./TagEditor";

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
  /** Every tag in use, for suggestions. */
  allTags: string[];
  setTags: (sessionId: string, tags: string[]) => Promise<void>;
  openTags: (sessionId: string) => void;
  /** Persist a temporary thread. */
  keep: (sessionId: string) => Promise<void>;
}

const ThreadActionsContext = createContext<ThreadActionsValue>({
  writable: false,
  menuState: () => ({}),
  run: () => false,
  pause: async () => undefined,
  resume: async () => undefined,
  allTags: [],
  setTags: async () => undefined,
  openTags: () => undefined,
  keep: async () => undefined,
});

export function useThreadActions(): ThreadActionsValue {
  return useContext(ThreadActionsContext);
}

export function ThreadActionsProvider({ children }: { children: ReactNode }) {
  const { api, refresh, setNotice, sessions } = useWorkspace();
  const writable = api.isDesktop !== false;
  const [tagging, setTagging] = useState<string>();
  const allTags = useMemo(() => collectTags(sessions).map((item) => item.tag), [sessions]);

  const setTags = useCallback(async (sessionId: string, tags: string[]) => {
    try { await api.setSessionTags(sessionId, tags); }
    catch (error) { setNotice(formatUserError(error)); }
    await refresh();
  }, [api, refresh, setNotice]);
  const openTags = useCallback((sessionId: string) => { if (writable) setTagging(sessionId); }, [writable]);

  const keep = useCallback(async (sessionId: string) => {
    try {
      await api.keepSession(sessionId);
      setNotice("Kept. This conversation is saved like any other.");
    } catch (error) { setNotice(formatUserError(error)); }
    await refresh();
  }, [api, refresh, setNotice]);

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
      tags: true,
      ...(session.temporary ? { keep: true } : {}),
      ...(session.workspaceMode === "worktree" ? { pause: session.paused ? "resume" as const : "pause" as const } : {}),
    };
  }, [writable]);

  const run = useCallback((action: string, session: Session) => {
    if (action === "pause") { void pause(session.id); return true; }
    if (action === "resume") { void resume(session.id); return true; }
    if (action === "tags") { openTags(session.id); return true; }
    if (action === "keep") { void keep(session.id); return true; }
    return false;
  }, [pause, resume, openTags, keep]);

  const value = useMemo(() => ({ writable, menuState, run, pause, resume, allTags, setTags, openTags, keep }), [writable, menuState, run, pause, resume, allTags, setTags, openTags, keep]);
  return (
    <ThreadActionsContext.Provider value={value}>
      {children}
      {tagging && <TagsDialog sessionId={tagging} onClose={() => setTagging(undefined)} />}
    </ThreadActionsContext.Provider>
  );
}

/** Tags for one thread, from its menu. Each change is saved as it is made. */
function TagsDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { sessions } = useWorkspace();
  const { allTags, setTags } = useThreadActions();
  const session = sessions.find((item) => item.id === sessionId);
  const dialog = useRef<HTMLDivElement>(null);
  useModalFocus(dialog, true, onClose, "input");
  if (!session) return null;
  return (
    <div className="palette-backdrop center" onClick={onClose}>
      <div className="dialog tags-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="tags-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <h3 id="tags-title">Tags</h3>
        <p className="tags-dialog-lede">For “{session.title}”. Group by tag in the sidebar, or search with #tag.</p>
        <TagEditor tags={session.tags ?? []} suggestions={allTags} autoFocus onChange={(next) => void setTags(session.id, next)} />
        <div className="actions">
          <button className="send" data-cancel onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
