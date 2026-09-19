import { useMemo, useState } from "react";
import type { DiffFile } from "@capsule/shared";
import { FileDiff } from "./FileDiff";
import { DIFF_PAGE_FILES, DIFF_PAGE_ROWS, DiffPager } from "./DiffPager";

/** A file-to-symlink change contains separate delete/add blocks at one path. */
export function diffBlockKeys(files: readonly DiffFile[]): string[] {
  const occurrences = new Map<string, number>();
  return files.map((file) => {
    const identity = JSON.stringify([file.oldPath, file.path, file.status]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return JSON.stringify([identity, occurrence]);
  });
}

export function PagedFileDiffs({ files, split, wrap = true, onAddComment }: {
  files: DiffFile[]; split: boolean; wrap?: boolean;
  onAddComment?: (filePath: string, line: number, side: "left" | "right") => void;
}) {
  const blocks = useMemo(() => {
    const keys = diffBlockKeys(files);
    return files.map((file, index) => ({ file, key: keys[index]! }));
  }, [files]);
  const initial = useMemo(() => {
    let budget = DIFF_PAGE_ROWS * 4;
    const expanded = new Set<string>();
    for (const { file, key } of blocks.slice(0, DIFF_PAGE_FILES)) {
      const size = file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
      if (size <= budget) { expanded.add(key); budget -= size; }
    }
    return { files, page: 0, expanded };
  }, [files, blocks]);
  const [stored, setStored] = useState(initial);
  const state = stored.files === files ? stored : initial;
  const visible = blocks.slice(state.page * DIFF_PAGE_FILES, (state.page + 1) * DIFF_PAGE_FILES);
  const allOpen = visible.every(({ key }) => state.expanded.has(key));
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
      <button type="button" className="chip" onClick={() => expand(visible.map(({ key }) => key), !allOpen)}>
        {allOpen ? "Collapse" : "Expand"} {files.length > DIFF_PAGE_FILES ? "page" : "all"}
      </button>
    </div>
    {visible.map(({ file, key }) => <FileDiff key={key} file={file} split={split} wrap={wrap}
      expanded={state.expanded.has(key)} onExpandedChange={(open) => expand([key], open)} onAddComment={onAddComment} />)}
  </div>;
}
