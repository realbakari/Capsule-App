import { useEffect, useMemo, useState } from "react";
import type { FileEntry } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";

export function FilePicker() {
  const { filePicker, setFilePicker, projectId, mentionFile, api } = useWorkspace();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (!filePicker || !projectId) {
      setFiles([]);
      return;
    }
    void api.searchFiles(projectId, query).then((entries: FileEntry[]) => {
      setFiles(entries);
      setIndex(0);
    });
  }, [api, filePicker, projectId, query]);

  const items = useMemo(() => files.slice(0, 40), [files]);

  if (!filePicker) return null;
  return (
    <div
      className="palette-backdrop"
      onClick={() => {
        setFilePicker(false);
        setQuery("");
      }}
    >
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          placeholder="Search project files…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((current) => Math.min(items.length - 1, current + 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((current) => Math.max(0, current - 1));
            }
            if (event.key === "Enter" && items[index]) {
              event.preventDefault();
              mentionFile(items[index].path);
              setFilePicker(false);
              setQuery("");
            }
            if (event.key === "Escape") {
              setFilePicker(false);
            }
          }}
        />
        {items.length === 0 && <div className="sidebar-empty">No files</div>}
        {items.map((item, itemIndex) => (
          <button
            key={item.path}
            className={itemIndex === index ? "active" : ""}
            onMouseEnter={() => setIndex(itemIndex)}
            onClick={() => {
              mentionFile(item.path);
              setFilePicker(false);
              setQuery("");
            }}
          >
            {item.path}
          </button>
        ))}
      </div>
    </div>
  );
}
