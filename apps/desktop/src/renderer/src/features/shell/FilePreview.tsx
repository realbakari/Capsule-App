import type { FilePreview } from "@capsule/shared";
import { highlight } from "../../lib/highlight";

export function FilePreviewView({
  doc,
  editing,
  contents,
  saveState,
  onChange,
  onMention,
  onOpen,
  onEdit,
  onView,
  onReload,
  onOverwrite,
}: {
  doc: FilePreview;
  editing: boolean;
  contents: string;
  saveState: "idle" | "saving" | "saved" | "error" | "truncated" | "conflict";
  onChange: (value: string) => void;
  onMention: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onView: () => void;
  onReload: () => void;
  onOverwrite: () => void;
}) {
  const canEdit = doc.kind === "text" && !doc.truncated && Boolean(doc.revision);
  return (
    <div className="file-preview">
      <div className="file-preview-bar">
        <span className="truncate mono" title={doc.path}>
          {doc.path}
        </span>
        <span className="meta">
          {doc.kind === "image" ? doc.mime : doc.language || doc.kind}
        </span>
        <button type="button" className="ghost" onClick={onMention}>
          Mention
        </button>
        <button type="button" className="ghost" onClick={onOpen}>
          Open
        </button>
        {canEdit ? (
          editing ? (
            <button type="button" className="ghost" onClick={onView}>
              Preview
            </button>
          ) : (
            <button type="button" className="ghost" onClick={onEdit}>
              Edit
            </button>
          )
        ) : null}
        {editing ? (
          <span className={`save-state ${saveState}`}>
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Save failed"
                  : ""}
          </span>
        ) : null}
      </div>
      {doc.truncated && doc.kind === "text" ? (
        <div className="faint file-editor-note">Showing the first part of a large file.</div>
      ) : null}
      {saveState === "conflict" && editing ? (
        <div className="file-conflict">
          <span>This file changed on disk since you opened it — probably the agent.</span>
          <span className="actions">
            <button className="chip" onClick={onReload}>
              Discard mine, reload
            </button>
            <button className="danger" onClick={onOverwrite}>
              Keep mine, overwrite
            </button>
          </span>
        </div>
      ) : null}
      {doc.kind === "image" && doc.dataUrl ? (
        <div className="file-preview-frame">
          <img src={doc.dataUrl} alt={doc.path} className="file-preview-image" />
        </div>
      ) : null}
      {doc.kind === "text" && editing ? (
        <textarea
          className="mono file-editor-area"
          spellCheck={false}
          value={contents}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
      {doc.kind === "text" && !editing ? (
        <pre className="mono file-preview-code">
          <code>{highlight(doc.contents ?? contents, doc.language)}</code>
        </pre>
      ) : null}
      {doc.kind === "binary" ? (
        <p className="faint">{doc.detail ?? "This file can’t be previewed here."}</p>
      ) : null}
    </div>
  );
}
