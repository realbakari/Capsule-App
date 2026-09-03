import type { GitStatus } from "@capsule/shared";
import type { TouchedFile } from "../../lib/activity";
import { useState } from "react";
import { useWorkspace } from "../../lib/workspace";

const COLLAPSED_LIMIT = 5;

const CODE_LABELS: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  "?": "added",
};

function statusLabel(code: string): string {
  const key = code.trim()[0] ?? "";
  return CODE_LABELS[key] ?? "changed";
}

/**
 * The outcome of a turn that touched the tree: which files moved and by how
 * much — not the contents. The diff itself belongs in the side panel, so this
 * stays a summary you can skim without leaving the thread.
 */
/*
 * A path is read basename-first: `workspace.tsx` is the answer, and the
 * directory is context. Splitting them lets the directory dim and truncate
 * while the filename stays legible, which is how Codex renders the same list.
 */
function splitPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf("/");
  return index < 0
    ? { dir: "", name: path }
    : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/*
 * The files this turn changed, and the way back to before it.
 *
 * `git` is still the source of the diff and discard actions — those are about
 * the working tree — but the list is the turn's, passed in. Rendering
 * `git.files` put every uncommitted file in the project under every reply,
 * including conversations that had touched nothing.
 */
export function ChangedFilesCard({ git, files }: { git: GitStatus; files: TouchedFile[] }) {
  const { api, gitDiscard, runs, setConfirm, setInspectorOpen, setInspectorTab } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [restoring, setRestoring] = useState(false);

  /*
   * The most recent finished turn that captured a checkpoint. Restoring puts
   * the worktree back to how that turn left it, which is the way out of an
   * edit the agent made and the user did not want.
   */
  const restorable = [...runs]
    .reverse()
    .find((run) => run.checkpointRef && run.status !== "running");

  async function restoreTurn() {
    if (!restorable) return;
    setConfirm({
      title: "Restore this turn?",
      // Says what is lost, because it is not recoverable through this button.
      detail:
        "Files in the project folder go back to how this turn left them. Anything changed since — by the agent or by you — is discarded.",
      confirmLabel: "Restore",
      danger: true,
      onConfirm: async () => {
        setRestoring(true);
        try {
          await api.restoreTurn(restorable.id);
        } finally {
          setRestoring(false);
        }
      },
    });
  }

  if (!git.isRepo || files.length === 0) return null;
  const shown = expanded ? files : files.slice(0, COLLAPSED_LIMIT);
  const hidden = files.length - shown.length;

  const openDiff = () => {
    setInspectorTab("diff");
    setInspectorOpen(true);
  };

  return (
    <div className="changed-files">
      <button className="changed-files-head" onClick={openDiff}>
        <span className="changed-files-count">
          {files.length} {files.length === 1 ? "file" : "files"} changed
        </span>
        {/* Binary files carry no line stats, so the totals can be absent even
            when files did change. Showing nothing beats showing a fake 0. */}
        {typeof git.added === "number" && (
          <span className="diffstat">
            <span className="added">+{git.added}</span>
            <span className="removed">−{git.removed ?? 0}</span>
          </span>
        )}
      </button>
      <ul className="changed-files-list">
        {shown.map((file) => (
          <li key={file.path}>
            <button onClick={openDiff} title={`${file.path} — ${file.action}`}>
              <span className={`change-code ${file.action}`} aria-hidden>
                {file.action === "created" ? "+" : file.action === "deleted" ? "−" : "M"}
              </span>
              <span className="change-path">
                <span className="change-dir">{splitPath(file.path).dir}</span>
                <span className="change-name">{splitPath(file.path).name}</span>
              </span>
              {typeof file.added === "number" && (
                <span className="diffstat">
                  <span className="added">+{file.added}</span>
                  <span className="removed">−{file.removed ?? 0}</span>
                </span>
              )}
            </button>
            {/* Discarding rewrites the working tree and cannot be undone from
                here, so it asks first and names the file it will revert. */}
            <button
              className="change-undo"
              title={`Discard changes to ${file.path}`}
              aria-label={`Discard changes to ${file.path}`}
              onClick={() =>
                setConfirm({
                  title: "Discard changes?",
                  detail: `${file.path} will be reverted to its last committed state. This cannot be undone.`,
                  danger: true,
                  confirmLabel: "Discard",
                  onConfirm: () => {
                    void gitDiscard(file.path);
                    setConfirm(undefined);
                  },
                })
              }
            >
              Undo
            </button>
          </li>
        ))}
      </ul>
      {restorable && (
        <div className="changed-files-actions">
          <button
            type="button"
            className="ghost"
            disabled={restoring}
            onClick={() => void restoreTurn()}
            title="Put the project folder back to how this turn left it"
          >
            {restoring ? "Restoring…" : "Restore this turn"}
          </button>
        </div>
      )}
      {hidden > 0 && (
        <button className="changed-files-more" onClick={() => setExpanded(true)}>
          Show {hidden} more
        </button>
      )}
    </div>
  );
}
