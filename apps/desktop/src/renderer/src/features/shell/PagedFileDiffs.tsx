import { useMemo, useState } from "react";
import type { DiffFile } from "@capsule/shared";
import { FileDiff } from "./FileDiff";
import { DIFF_PAGE_FILES, DIFF_PAGE_ROWS, DiffPager } from "./DiffPager";

export function PagedFileDiffs({ files, split, wrap = true, onAddComment }: {
  files: DiffFile[]; split: boolean; wrap?: boolean;
  onAddComment?: (filePath: string, line: number, side: "left" | "right") => void;
}) {
  const initial = useMemo(() => {
    let budget = DIFF_PAGE_ROWS * 4;
    const expanded = new Set<string>();
    for (const file of files.slice(0, DIFF_PAGE_FILES)) {
      const size = file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
      if (size <= budget) { expanded.add(file.path); budget -= size; }
    }
    return { files, page: 0, expanded };
  }, [files]);
  const [stored, setStored] = useState(initial);
  const state = stored.files === files ? stored : initial;
  const visible = files.slice(state.page * DIFF_PAGE_FILES, (state.page + 1) * DIFF_PAGE_FILES);
  const allOpen = visible.every((file) => state.expanded.has(file.path));
  const expand = (paths: string[], open: boolean) => {
    setStored((previous) => {
      const current = previous.files === files ? previous : initial;
      const expanded = new Set(current.expanded);
      for (const path of paths) { if (open) expanded.add(path); else expanded.delete(path); }
      return { ...current, expanded };
    });
  };
  return <div className="pr-file-diffs">
    <div className="diff-list-controls">
      <DiffPager page={state.page} pages={Math.ceil(files.length / DIFF_PAGE_FILES)} label="Files" onChange={(page) => setStored({ ...state, page })} />
      <button type="button" className="chip" onClick={() => expand(visible.map((file) => file.path), !allOpen)}>
        {allOpen ? "Collapse" : "Expand"} {files.length > DIFF_PAGE_FILES ? "page" : "all"}
      </button>
    </div>
    {visible.map((file) => <FileDiff key={file.path} file={file} split={split} wrap={wrap}
      expanded={state.expanded.has(file.path)} onExpandedChange={(open) => expand([file.path], open)} onAddComment={onAddComment} />)}
  </div>;
}
