import { useEffect, useRef } from "react";
import { useWorkspace } from "../../lib/workspace";

export function ArchiveUndoNotice() {
  const { archiveUndo, restoreSession, dismissArchiveUndo } = useWorkspace();
  const actions = useRef({ restoreSession, dismissArchiveUndo });
  actions.current = { restoreSession, dismissArchiveUndo };
  useEffect(() => {
    if (!archiveUndo) return;
    const timer = setTimeout(() => actions.current.dismissArchiveUndo(), 10_000);
    const undo = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true'], [role='dialog']")) return;
      event.preventDefault(); void actions.current.restoreSession(archiveUndo.id);
    };
    document.addEventListener("keydown", undo);
    return () => { clearTimeout(timer); document.removeEventListener("keydown", undo); };
  }, [archiveUndo]);
  if (!archiveUndo) return null;
  return <div className="archive-undo-notice" role="status">
    <span title={archiveUndo.title}>Archived “{archiveUndo.title}”</span>
    <button className="ghost" onClick={() => void restoreSession(archiveUndo.id)}>Undo</button>
    <button className="ghost" aria-label="Dismiss archive notification" onClick={dismissArchiveUndo}>×</button>
  </div>;
}
