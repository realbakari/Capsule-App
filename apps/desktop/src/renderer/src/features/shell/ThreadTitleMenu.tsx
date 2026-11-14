import { useEffect, useRef, useState } from "react";
import { buildSessionActionMenuItems, copyAnchor, type MenuAnchor } from "../../lib/action-menu";
import { useWorkspace } from "../../lib/workspace";
import { ActionMenu } from "./ActionMenu";
import { useApplyToLocal } from "../apply/ApplyToLocal";
import { useThreadShare } from "../share/ThreadShare";
import { ChevronDownIcon } from "./icons";

/**
 * The conversation's name in the titlebar is also its menu: the same actions
 * as its row in the sidebar, reachable while the sidebar is collapsed. Rename
 * happens in place, in the titlebar.
 */
export function ThreadTitleMenu() {
  const { session, project, renameSession, pinSession, regenerateTitle, archiveSession, deleteSession, openPath } = useWorkspace();
  const applyToLocal = useApplyToLocal();
  const share = useThreadShare();
  const [anchor, setAnchor] = useState<MenuAnchor>();
  const [editing, setEditing] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setAnchor(undefined); setEditing(undefined); }, [session?.id]);
  useEffect(() => { if (editing !== undefined) input.current?.select(); }, [editing !== undefined]);
  if (!session) return null;
  const folder = session.workingDirectory || project?.workingDirectory;

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
          items={buildSessionActionMenuItems({ pinned: Boolean(session.pinned), hasFolder: Boolean(folder), ...(applyToLocal.offered ? { applyToLocal: { disabledReason: applyToLocal.disabledReason } } : {}), share: { exportOffered: share.exportOffered, shareOffered: share.shareOffered } })}
          point={{ x: anchor.left, y: anchor.bottom }}
          anchor={anchor}
          keyboard={false}
          onClose={() => setAnchor(undefined)}
          onSelect={(action) => {
            setAnchor(undefined);
            if (action === "rename") setEditing(session.title);
            else if (action === "pin" || action === "unpin") void pinSession(session.id, action === "pin");
            else if (action === "generate-title") void regenerateTitle(session.id);
            else if (action === "open-folder" && folder) void openPath(folder);
            else if (action === "copy-path" && folder) void navigator.clipboard.writeText(folder);
            else if (action === "apply-to-local") applyToLocal.apply();
            else if (action === "export-markdown") share.openExport(session.id);
            else if (action === "copy-markdown") share.copyMarkdown(session.id);
            else if (action === "share-link") share.openShare(session.id);
            else if (action === "archive") void archiveSession(session.id);
            else if (action === "delete") deleteSession(session.id);
          }}
        />
      )}
    </>
  );
}
