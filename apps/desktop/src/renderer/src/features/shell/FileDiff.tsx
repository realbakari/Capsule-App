import { memo, useMemo, useState } from "react";
import { splitRows, type DiffFile, type DiffHunk, type DiffLine } from "@capsule/shared";
import { highlight } from "../../lib/highlight";

/*
 * One file of a patch, rendered with split and unified diff support:
 * - Rounded file type badge
 * - Monospace file path with distinct directory vs name styling
 * - +N -M diff stats
 * - Split diff with diagonal hatched background for empty side
 * - Gutter line hover '+' button for inline commenting
 */

function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut + 1);
}

function nameOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}

// Memoize by text/path: collapsing a sibling or drafting a note should not
// tokenize the whole patch again. The highlighter emits React text, not HTML.
const DiffText = memo(function DiffText({ text, filePath }: { text: string; filePath?: string }) {
  return <>{highlight(text || " ", filePath?.split(".").pop())}</>;
});

const STATUS_LABEL: Record<DiffFile["status"], string> = {
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  modified: "Modified",
};

export function FileBadgeIcon() {
  return (
    <span className="file-badge-icon" aria-hidden>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="3" stroke="#38bdf8" strokeWidth="1.5" fill="#0284c7" fillOpacity="0.18" />
        <circle cx="8" cy="8" r="2.2" fill="#38bdf8" />
      </svg>
    </span>
  );
}

function UnifiedHunk({
  hunk,
  filePath,
  onAddComment,
}: {
  hunk: DiffHunk;
  filePath?: string;
  onAddComment?: (filePath: string, line: number, side: "left" | "right") => void;
}) {
  return (
    <>
      <div className="diff-row diff-row--hunk">
        <span className="diff-gutter" aria-hidden />
        <span className="diff-gutter" aria-hidden />
        <code className="diff-text">{hunk.header}</code>
      </div>
      {hunk.lines.map((line, index) => {
        const lineNum = line.newLine ?? line.oldLine;
        return (
          <div className={`diff-row diff-row--${line.kind}`} key={`${index}-${line.text.slice(0, 16)}`}>
            <span className="diff-gutter">
              <span className="diff-gutter-num">{line.oldLine ?? ""}</span>
            </span>
            <span className="diff-gutter">
              <span className="diff-gutter-num">{line.newLine ?? ""}</span>
              {lineNum && onAddComment && filePath ? (
                <button
                  type="button"
                  className="diff-gutter-add-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddComment(filePath, lineNum, line.kind === "del" ? "left" : "right");
                  }}
                  title="Add review note"
                >
                  +
                </button>
              ) : null}
            </span>
            <code className="diff-text">
              <span className="diff-marker" aria-hidden>
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
              </span>
              <DiffText text={line.text} filePath={filePath} />
            </code>
          </div>
        );
      })}
    </>
  );
}

function SplitCell({
  line,
  side,
  filePath,
  onAddComment,
}: {
  line?: DiffLine;
  side: "left" | "right";
  filePath?: string;
  onAddComment?: (filePath: string, line: number, side: "left" | "right") => void;
}) {
  const tone = line ? `diff-half--${line.kind}` : "diff-half--empty";
  const edge = side === "left" ? "diff-cell--edge" : "";
  const lineNum = side === "left" ? line?.oldLine : line?.newLine;

  return (
    <>
      <span className={`diff-gutter ${tone}`}>
        <span className="diff-gutter-num">
          {line ? (lineNum ?? "") : ""}
        </span>
        {line && lineNum && onAddComment && filePath ? (
          <button
            type="button"
            className="diff-gutter-add-btn"
            onClick={(e) => {
              e.stopPropagation();
              onAddComment(filePath, lineNum, side);
            }}
            title="Add review note"
          >
            +
          </button>
        ) : null}
      </span>
      <code className={`diff-text ${tone} ${edge}`}><DiffText text={line?.text ?? ""} filePath={filePath} /></code>
    </>
  );
}

function SplitHunk({
  hunk,
  filePath,
  onAddComment,
}: {
  hunk: DiffHunk;
  filePath?: string;
  onAddComment?: (filePath: string, line: number, side: "left" | "right") => void;
}) {
  const rows = useMemo(() => splitRows(hunk), [hunk]);
  return (
    <>
      <div className="diff-split-row diff-split-row--hunk">
        <code className="diff-text">{hunk.header}</code>
      </div>
      {rows.map((row, index) => (
        <div className="diff-split-row" key={index}>
          <SplitCell
            line={row.left}
            side="left"
            filePath={filePath}
            onAddComment={onAddComment}
          />
          <SplitCell
            line={row.right}
            side="right"
            filePath={filePath}
            onAddComment={onAddComment}
          />
        </div>
      ))}
    </>
  );
}

export function FileDiff({
  file,
  split,
  wrap = true,
  defaultOpen = true,
  expanded,
  onExpandedChange,
  onAddComment,
}: {
  file: DiffFile;
  split: boolean;
  wrap?: boolean;
  defaultOpen?: boolean;
  expanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
  onAddComment?: (filePath: string, line: number, side: "left" | "right") => void;
}) {
  const [localOpen, setOpen] = useState(defaultOpen);
  const open = expanded ?? localOpen;
  const label = STATUS_LABEL[file.status];
  return (
    <section className={`file-diff ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="file-diff-head"
        aria-expanded={open}
        onClick={() => onExpandedChange ? onExpandedChange(!open) : setOpen(!open)}
      >
        <span className="file-diff-caret" aria-hidden>
          {open ? (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M6.427 4.427l3.396 3.396a.25.25 0 010 .354l-3.396 3.396A.25.25 0 016 11.396V4.604a.25.25 0 01.427-.177z" />
            </svg>
          )}
        </span>
        <FileBadgeIcon />
        <span className="mono file-diff-path" title={file.path}>
          <span className="file-diff-dir">{dirOf(file.path)}</span>
          <span className="file-diff-name">{nameOf(file.path)}</span>
        </span>
        {file.oldPath && file.status === "renamed" ? (
          <span className="file-diff-from mono" title={file.oldPath}>
            from {file.oldPath}
          </span>
        ) : null}
        {file.status !== "modified" ? (
          <span className={`file-diff-status file-diff-status--${file.status}`}>{label}</span>
        ) : null}
        <span className="pr-diff-stat">
          <span className="file-diff-chip file-diff-chip--add">+{file.additions}</span>
          <span className="file-diff-chip file-diff-chip--del">−{file.deletions}</span>
        </span>
      </button>
      {open ? (
        file.binary ? (
          <p className="faint file-diff-binary">Binary file — no text to show.</p>
        ) : file.hunks.length === 0 ? (
          <p className="faint file-diff-binary">
            {file.status === "renamed" ? "Renamed with no changes to its contents." : "No changes to show."}
          </p>
        ) : (
          <div className={`file-diff-body ${split ? "is-split" : "is-unified"} ${wrap ? "is-wrapped" : "is-scrollable"}`} tabIndex={wrap ? undefined : 0} role={wrap ? undefined : "region"} aria-label={wrap ? undefined : `Scrollable diff for ${file.path}`}>
            {file.hunks.map((hunk, index) =>
              split ? (
                <SplitHunk
                  hunk={hunk}
                  key={`${hunk.header}-${index}`}
                  filePath={file.path}
                  onAddComment={onAddComment}
                />
              ) : (
                <UnifiedHunk
                  hunk={hunk}
                  key={`${hunk.header}-${index}`}
                  filePath={file.path}
                  onAddComment={onAddComment}
                />
              ),
            )}
          </div>
        )
      ) : null}
    </section>
  );
}
