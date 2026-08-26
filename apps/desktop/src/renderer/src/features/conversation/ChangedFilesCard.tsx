import type { GitStatus } from "@capsule/shared";
import { useState } from "react";
import { useWorkspace } from "../../lib/workspace";

const COLLAPSED_LIMIT = 5;

const CODE_LABELS: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  "?": "untracked",
};

function statusLabel(code: string): string {
  const key = code.trim()[0] ?? "";
  return CODE_LABELS[key] ?? "changed";
}

/**
 * The outcome of a turn that touched the tree: which files moved and by how
 * much — not the contents. Following T3 Code, the diff itself belongs in the
 * side panel, so this stays a summary you can skim without leaving the thread.
 */
export function ChangedFilesCard({ git }: { git: GitStatus }) {
  const { setInspectorOpen, setInspectorTab } = useWorkspace();
  const [expanded, setExpanded] = useState(false);

  if (!git.isRepo || git.files.length === 0) return null;
  const shown = expanded ? git.files : git.files.slice(0, COLLAPSED_LIMIT);
  const hidden = git.files.length - shown.length;

  const openDiff = () => {
    setInspectorTab("diff");
    setInspectorOpen(true);
  };

  return (
    <div className="changed-files">
      <button className="changed-files-head" onClick={openDiff}>
        <span className="changed-files-count">
          {git.files.length} {git.files.length === 1 ? "file" : "files"} changed
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
            <button onClick={openDiff} title={`${file.path} — ${statusLabel(file.code)}`}>
              <span className={`change-code ${statusLabel(file.code)}`} aria-hidden>
                {file.code.trim()[0] ?? "M"}
              </span>
              <span className="change-path">{file.path}</span>
              {typeof file.added === "number" && (
                <span className="diffstat">
                  <span className="added">+{file.added}</span>
                  <span className="removed">−{file.removed ?? 0}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button className="changed-files-more" onClick={() => setExpanded(true)}>
          Show {hidden} more
        </button>
      )}
    </div>
  );
}
