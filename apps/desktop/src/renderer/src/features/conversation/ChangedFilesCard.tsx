import type { TouchedFile } from "../../lib/activity";
import { useState } from "react";

const COLLAPSED_LIMIT = 5;

/**
 * The outcome of a turn that touched the tree: which files moved and by how
 * much — not the contents. The owning turn can expand its saved diff below
 * this summary without consulting the current working tree.
 */
/*
 * A path is read basename-first: `workspace.tsx` is the answer, and the
 * directory is context. Splitting them lets the directory dim and truncate
 * while the filename stays legible.
 */
function splitPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf("/");
  return index < 0
    ? { dir: "", name: path }
    : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/*
 * A saved turn's outcome. Its owner supplies both data and actions, so this
 * card cannot silently select another run or discard today's working tree.
 */
export function ChangedFilesCard({ files, onOpenDiff, onRestore, restoring = false }: {
  files: TouchedFile[];
  onOpenDiff?: () => void;
  onRestore?: () => void;
  restoring?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const shown = expanded ? files : files.slice(0, COLLAPSED_LIMIT);
  const hidden = files.length - shown.length;
  const FileControl = onOpenDiff ? "button" : "div";

  /*
   * Totals for the files listed here, not for the working tree.
   *
   * The header read git.added and git.removed — every uncommitted change in
   * the project, including files this turn never touched — while the rows
   * below it were the turn's. The two disagreed in plain sight: a header
   * saying "+17 −0" above rows summing to −74, and an untracked file nobody
   * had mentioned contributing the 17.
   */
  const totals = files.reduce(
    (sum, file) => ({
      added: sum.added + (file.added ?? 0),
      removed: sum.removed + (file.removed ?? 0),
      counted: sum.counted || file.added !== undefined || file.removed !== undefined,
    }),
    { added: 0, removed: 0, counted: false },
  );

  return (
    <div className="changed-files">
      {/*
        * "Since", not "by".
        *
        * This is measured from the previous turn's checkpoint to this one's,
        * so it holds every change the project saw in between — including the
        * ones the person made in a terminal while the agent was idle. A turn
        * that committed two files was headed "16 files changed" because four
        * commits had been made outside the app in between. The measurement is
        * worth keeping; the claim that the agent made it was not.
        */}
      <FileControl
        className="changed-files-head"
        onClick={onOpenDiff}
        title={
          onOpenDiff
            ? "View the saved diff for this point in the thread"
            : "Everything that changed in the project between the previous turn and this one"
        }
      >
        <span className="changed-files-count">
          {files.length} {files.length === 1 ? "file" : "files"} changed
          <span className="changed-files-scope"> since the previous turn</span>
        </span>
        {/* Binary files carry no line stats, so the totals can be absent even
            when files did change. Showing nothing beats showing a fake 0. */}
        {totals.counted && (
          <span className="diffstat">
            <span className="added">+{totals.added}</span>
            <span className="removed">−{totals.removed}</span>
          </span>
        )}
      </FileControl>
      <ul className="changed-files-list">
        {shown.map((file) => (
          <li key={file.path}>
            <FileControl className="changed-file-row" onClick={onOpenDiff} title={`${file.path} — ${file.action}`}>
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
            </FileControl>
          </li>
        ))}
      </ul>
      {/*
        * One footer, not two. "Show 6 more" and "Restore this turn" were
        * stacked full-width bars below the list — two rows of chrome under
        * five rows of content, and the reader's next move buried under the
        * destructive one.
        */}
      {(hidden > 0 || expanded || onRestore) && (
        <div className="changed-files-actions">
          {hidden > 0 ? (
            <button className="ghost" type="button" onClick={() => setExpanded(true)}>
              Show {hidden} more
            </button>
          ) : expanded && files.length > COLLAPSED_LIMIT ? (
            <button className="ghost" type="button" onClick={() => setExpanded(false)}>
              Show less
            </button>
          ) : (
            <span />
          )}
          {onRestore && (
            <button
              type="button"
              className="ghost"
              disabled={restoring}
              onClick={onRestore}
              title="Put the project folder back to how this turn left it"
            >
              {restoring ? "Restoring…" : "Restore this turn"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
