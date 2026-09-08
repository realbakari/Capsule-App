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
  onRetry,
  onCopy,
}: {
  doc: FilePreview;
  editing: boolean;
  contents: string;
  saveState: "idle" | "pending" | "saving" | "saved" | "error" | "truncated" | "conflict";
  onChange: (value: string) => void;
  onMention: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onView: () => void;
  onReload: () => void;
  onOverwrite: () => void;
  onRetry?: () => void;
  onCopy?: () => void;
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
        {saveState !== "idle" ? (
          <span className={`save-state ${saveState}`}>
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Save failed"
                  : saveState === "pending" ? "Unsaved" : ""}
          </span>
        ) : null}
      </div>
      {doc.truncated && doc.kind === "text" ? (
        <div className="faint file-editor-note">Showing the first part of a large file.</div>
      ) : null}
      {(saveState === "conflict" || saveState === "error") ? (
        <div className="file-conflict">
          <span>{saveState === "conflict" ? "This file changed on disk since you opened it." : "The file could not be saved."} Your draft is retained until the app closes.</span>
          <span className="actions">
            <button className="chip" onClick={onReload}>
              Discard mine, reload
            </button>
            <button className="chip" onClick={onCopy}>Copy draft</button>
            {saveState === "error" && <button className="chip" onClick={onRetry}>Retry save</button>}
            {saveState === "conflict" && <button className="danger" onClick={onOverwrite}>
              Keep mine, overwrite
            </button>}
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
