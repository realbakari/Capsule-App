import { useEffect, useRef, useState } from "react";
import { copyAnchor, type MenuAnchor } from "../../lib/action-menu";
import { useSessionActions } from "../triage/session-actions";
import { useWorkspace } from "../../lib/workspace";
import { ActionMenu } from "./ActionMenu";
import { ChevronDownIcon } from "./icons";

const RENAME_THREAD_EVENT = "capsule:rename-thread";

/** Starts renaming the open conversation in place, in the titlebar. */
export function requestRename(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(RENAME_THREAD_EVENT, { detail: sessionId }));
}

/**
 * The conversation's name in the titlebar is also its menu: the same actions
 * as its row in the sidebar, reachable while the sidebar is collapsed. Rename
 * happens in place, in the titlebar.
 */
export function ThreadTitleMenu() {
  const { session, renameSession } = useWorkspace();
  const actions = useSessionActions();
  const [anchor, setAnchor] = useState<MenuAnchor>();
  const [editing, setEditing] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setAnchor(undefined); setEditing(undefined); }, [session?.id]);
  useEffect(() => { if (editing !== undefined) input.current?.select(); }, [editing !== undefined]);
  useEffect(() => {
    const start = (event: Event) => {
      if (session && (event as CustomEvent<string>).detail === session.id) { setAnchor(undefined); setEditing(session.title); }
    };
    window.addEventListener(RENAME_THREAD_EVENT, start);
    return () => window.removeEventListener(RENAME_THREAD_EVENT, start);
  }, [session]);
  if (!session) return null;

  const commit = () => {
    const title = editing?.trim();
    setEditing(undefined);
    if (title && title !== session.title) void renameSession(session.id, title);
  };

  if (editing !== undefined) {
    return (
      <input
        ref={input}
        className="thread-title-edit"
        aria-label="Conversation name"
        value={editing}
        onChange={(event) => setEditing(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); commit(); }
          if (event.key === "Escape") { event.preventDefault(); setEditing(undefined); }
        }}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        className="breadcrumb-segment session-segment thread-title-trigger"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(anchor ? undefined : copyAnchor(event.currentTarget.getBoundingClientRect()))}
        onDoubleClick={() => { setAnchor(undefined); setEditing(session.title); }}
      >
        <span className="truncate">{session.title}</span>
        <ChevronDownIcon size={12} />
      </button>
      {anchor && (
        <ActionMenu
          items={actions.items(session)}
          point={{ x: anchor.left, y: anchor.bottom }}
          anchor={anchor}
          keyboard={false}
          onClose={() => setAnchor(undefined)}
          onSelect={(action) => {
            setAnchor(undefined);
            if (actions.run(session, action) === "rename") setEditing(session.title);
          }}
        />
      )}
    </>
  );
}
