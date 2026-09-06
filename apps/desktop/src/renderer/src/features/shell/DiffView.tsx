import { useMemo, useState } from "react";
import { DIFF_PAGE_ROWS, DiffPager } from "./DiffPager";

export function DiffView({ text }: { text: string }) {
  const lines = useMemo(() => text.split(/\n/), [text]);
  const [selection, setSelection] = useState({ text, page: 0 });
  const page = selection.text === text ? selection.page : 0;
  if (!text.trim()) return <div className="faint">No diff.</div>;
  return <>
    <DiffPager page={page} pages={Math.ceil(lines.length / DIFF_PAGE_ROWS)} label="Diff lines" onChange={(page) => setSelection({ text, page })} />
    <pre className="diff-view mono">
      {lines.slice(page * DIFF_PAGE_ROWS, (page + 1) * DIFF_PAGE_ROWS).map((line, index) => {
        const kind = line.startsWith("+++") || line.startsWith("---")
          ? "file"
          : line.startsWith("+")
            ? "add"
            : line.startsWith("-")
              ? "del"
              : line.startsWith("@@")
                ? "hunk"
                : "ctx";
        return (
          <div className={`diff-line ${kind}`} key={`${index}-${line.slice(0, 24)}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  </>;
}
