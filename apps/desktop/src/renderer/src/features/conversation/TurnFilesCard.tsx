import type { TouchedFile } from "../../lib/activity";
import { FileIcon } from "../shell/icons";

function splitPath(path: string): { dir: string; name: string } {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0
    ? { dir: "", name: path }
    : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

const ACTION_LABELS: Record<TouchedFile["action"], { symbol: string; label: string; className: string }> = {
  created: { symbol: "+", label: "Created", className: "created" },
  modified: { symbol: "~", label: "Modified", className: "modified" },
  deleted: { symbol: "−", label: "Deleted", className: "deleted" },
  read: { symbol: "•", label: "Read", className: "read" },
};

interface TurnFilesCardProps {
  files: TouchedFile[];
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path?: string) => void;
  onDiscardFile?: (path: string) => void;
  onRestoreTurn?: () => void;
  restorable?: boolean;
  restoring?: boolean;
}

export function TurnFilesCard({
  files,
  onOpenFile,
  onOpenDiff,
  onDiscardFile,
  onRestoreTurn,
  restorable,
  restoring,
}: TurnFilesCardProps) {
  if (!files || files.length === 0) return null;

  const createdCount = files.filter((f) => f.action === "created").length;
  const modifiedCount = files.filter((f) => f.action === "modified").length;
  const deletedCount = files.filter((f) => f.action === "deleted").length;

  const totalAdded = files.reduce((acc, f) => acc + (f.added ?? 0), 0);
  const totalRemoved = files.reduce((acc, f) => acc + (f.removed ?? 0), 0);

  return (
    <div className="turn-files-card">
      <div className="turn-files-header">
        <div className="turn-files-title">
          <FileIcon size={14} className="turn-files-icon" />
          <span>
            {files.length} {files.length === 1 ? "file" : "files"} changed
            {createdCount > 0 && ` · ${createdCount} created`}
            {modifiedCount > 0 && ` · ${modifiedCount} modified`}
            {deletedCount > 0 && ` · ${deletedCount} deleted`}
          </span>
        </div>
        <div className="turn-files-stats">
          {(totalAdded > 0 || totalRemoved > 0) && (
            <span className="diffstat">
              {totalAdded > 0 && <span className="added">+{totalAdded}</span>}
              {totalRemoved > 0 && <span className="removed">−{totalRemoved}</span>}
            </span>
          )}
          {onOpenDiff && (
            <button
              type="button"
              className="turn-files-diff-btn"
              onClick={() => onOpenDiff()}
              title="Open diff in Inspector"
            >
              Diff
            </button>
          )}
          {restorable && onRestoreTurn && (
            <button
              type="button"
              className="turn-files-restore-btn"
              disabled={restoring}
              onClick={onRestoreTurn}
              title="Revert project folder back to how this turn left it"
            >
              {restoring ? "Restoring…" : "Restore turn"}
            </button>
          )}
        </div>
      </div>

      <div className="turn-files-list">
        {files.map((file) => {
          const info = ACTION_LABELS[file.action] ?? ACTION_LABELS.modified;
          const { dir, name } = splitPath(file.path);
          return (
            <div key={file.path} className="turn-file-row">
              <button
                type="button"
                className={`turn-file-pill ${info.className}`}
                onClick={() => {
                  if (onOpenDiff) onOpenDiff(file.path);
                  else onOpenFile?.(file.path);
                }}
                title={`${file.path} (${info.label}) — Click to view`}
              >
                <span className={`turn-file-badge ${info.className}`} aria-hidden>
                  {info.symbol}
                </span>
                <span className="turn-file-path">
                  {dir && <span className="turn-file-dir">{dir}</span>}
                  <span className="turn-file-name">{name}</span>
                </span>
                {(typeof file.added === "number" || typeof file.removed === "number") && (
                  <span className="diffstat">
                    {typeof file.added === "number" && (
                      <span className="added">+{file.added}</span>
                    )}
                    {typeof file.removed === "number" && file.removed > 0 && (
                      <span className="removed">−{file.removed}</span>
                    )}
                  </span>
                )}
              </button>
              {onDiscardFile && file.action !== "read" && (
                <button
                  type="button"
                  className="turn-file-undo"
                  onClick={() => onDiscardFile(file.path)}
                  title={`Discard changes to ${file.path}`}
                  aria-label={`Discard changes to ${file.path}`}
                >
                  Undo
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
