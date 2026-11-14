import { useMemo, useState } from "react";
import { collectTags, normalizeTag } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import "./threads.css";

/** Every tag in use, renamed or removed on all conversations at once. */
export function TagsSettings() {
  const { api, sessions, refresh } = useWorkspace();
  const tags = useMemo(() => collectTags(sessions), [sessions]);
  const [editing, setEditing] = useState<{ tag: string; value: string }>();
  const [confirming, setConfirming] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try { await work(); await refresh(); }
    catch (reason) { setError(formatUserError(reason)); }
    finally { setBusy(false); }
  };

  const rename = () => {
    if (!editing) return;
    const target = normalizeTag(editing.value);
    if (!target) { setError("A tag needs a name."); return; }
    const from = editing.tag;
    setEditing(undefined);
    if (target !== from) void act(() => api.renameTag(from, target));
  };

  return (
    <div className="card tags-settings">
      <h3>Tags</h3>
      <p className="muted">Rename or delete a tag on every conversation that has it. Renaming onto a tag that exists merges the two.</p>
      {tags.length === 0 ? <p className="faint">No tags yet. Add one from a conversation’s menu or its Conversation details.</p> : (
        <ul className="tags-settings-list">
          {tags.map(({ tag, count }) => (
            <li key={tag} className="tags-settings-row">
              {editing?.tag === tag ? (
                <input autoFocus className="tags-settings-input" aria-label={`New name for ${tag}`} value={editing.value}
                  onChange={(event) => setEditing({ tag, value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") rename();
                    if (event.key === "Escape") setEditing(undefined);
                  }}
                  onBlur={rename} />
              ) : (
                <span className="tag-chip"><span className="tag-chip-name">#{tag}</span></span>
              )}
              <span className="faint tags-settings-count">{count} {count === 1 ? "conversation" : "conversations"}</span>
              <span className="tags-settings-actions">
                {confirming === tag ? <>
                  <button type="button" className="chip danger" disabled={busy} onClick={() => { setConfirming(undefined); void act(() => api.deleteTag(tag)); }}>Delete from {count}</button>
                  <button type="button" className="chip" onClick={() => setConfirming(undefined)}>Cancel</button>
                </> : <>
                  <button type="button" className="chip" disabled={busy} onClick={() => { setConfirming(undefined); setEditing({ tag, value: tag }); }}>Rename</button>
                  <button type="button" className="chip" disabled={busy} onClick={() => { setEditing(undefined); setConfirming(tag); }}>Delete</button>
                </>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="tags-settings-error">{error}</p>}
    </div>
  );
}
