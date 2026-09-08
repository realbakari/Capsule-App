import { useState, useSyncExternalStore } from "react";
import { fileDrafts, fileOwnerKey, type FileOwner } from "../../lib/file-drafts";
import { formatUserError } from "../../lib/errors";

/** Recovery is independent of the file reader: deleted files still have a draft. */
export function RecoverableFiles({ onError, onDiscard }: { onError: (message: string) => void; onDiscard: (owner: FileOwner) => void }) {
  const [confirmDiscard, setConfirmDiscard] = useState<string>();
  const drafts = useSyncExternalStore(fileDrafts.subscribe, fileDrafts.getSnapshot);
  const failed = drafts.filter((draft) => draft.state !== "pending");
  if (!failed.length) return null;
  return <details className="advanced">
    <summary>{failed.length} unsaved file {failed.length === 1 ? "draft" : "drafts"}</summary>
    <p className="faint">Kept in this window until the app closes. Reopen the file to retry, or copy the draft even if the file is no longer readable.</p>
    {failed.map((draft) => <div key={fileOwnerKey(draft.owner)} className="actions">
      <span title={draft.owner.root}>{draft.owner.path}</span>
      <button className="chip" onClick={() => void navigator.clipboard.writeText(draft.contents).catch((error) => onError(formatUserError(error)))}>Copy unsaved draft</button>
      {confirmDiscard === fileOwnerKey(draft.owner) ? <>
        <span>Discard this unsaved copy? This cannot be undone.</span>
        <button className="chip" onClick={() => { onDiscard(draft.owner); setConfirmDiscard(undefined); }}>Confirm discard</button>
        <button className="chip" onClick={() => setConfirmDiscard(undefined)}>Keep draft</button>
      </> : <button className="chip" onClick={() => setConfirmDiscard(fileOwnerKey(draft.owner))}>Discard draft</button>}
    </div>)}
  </details>;
}
