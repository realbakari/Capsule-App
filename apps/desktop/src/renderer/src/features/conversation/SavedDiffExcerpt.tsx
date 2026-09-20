import { Fragment, memo, type CSSProperties } from "react";
import type { DiffFile } from "@capsule/shared";
import { highlight } from "../../lib/highlight";

/** One grid owns every row's width; its opaque gutter stays readable on scroll. */
export const SavedDiffExcerpt = memo(function SavedDiffExcerpt({ file }: { file: DiffFile }) {
  let digits = 2;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      digits = Math.max(digits, String(line.oldLine ?? "").length, String(line.newLine ?? "").length);
    }
  }
  const style = { "--preview-line-digits": `${digits}ch` } as CSSProperties;
  const language = file.path.split(".").pop();

  return <div className="saved-diff-preview-grid" style={style}>
    {file.hunks.map((hunk, index) => <Fragment key={index}>
      <div className="saved-diff-preview-hunk"><span>{hunk.header}</span></div>
      {hunk.lines.map((line, row) => <div className={`saved-diff-preview-line ${line.kind}`} key={row}>
        <span className="preview-line-gutter" aria-hidden="true">
          <span className="preview-line-number">{line.oldLine ?? ""}</span>
          <span className="preview-line-number">{line.newLine ?? ""}</span>
          <span className="preview-line-sign">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
        </span>
        <code>{highlight(line.text || " ", language)}</code>
      </div>)}
    </Fragment>)}
  </div>;
});
