import type { FileEntry, GitChange } from "@capsule/shared";
import { memo, useMemo } from "react";
import { folderBasename } from "@capsule/shared";
import { fileKind } from "../../lib/file-kind";
import type { DirectoryListing } from "../../lib/directory-listings";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  SearchIcon,
  XIcon,
} from "./icons";

const HIDDEN_TREE_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  ".next",
  "coverage",
  "build",
  "Pods",
]);


/** File-type mark for a tree row. See lib/file-kind for why it is a label. */
function FileMark({ name }: { name: string }) {
  const kind = fileKind(name.split("/").pop() ?? name);
  return (
    <span className="codex-tree-icon codex-file-mark" style={{ color: `var(${kind.tone})` }} aria-hidden>
      {kind.label}
    </span>
  );
}

export function sortTreeEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries]
    .filter((entry) => entry.name !== ".DS_Store" && !HIDDEN_TREE_NAMES.has(entry.name))
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

export function indexGitMarks(files: readonly GitChange[] = []) {
  const file = new Map<string, string>();
  const directory = new Map<string, string>();
  for (const change of files) {
    const mark = change.code?.trim().charAt(0) ?? "";
    const parts = change.path.split("/");
    // Preserve the first matching status, including paths relative to a nested root.
    for (let start = 0; start < parts.length; start += 1) {
      const suffix = parts.slice(start).join("/");
      if (!file.has(suffix)) file.set(suffix, mark);
      if (!directory.has(suffix)) directory.set(suffix, mark);
    }
    for (let end = 1; end < parts.length; end += 1) {
      const ancestor = parts.slice(0, end).join("/");
      if (!directory.has(ancestor)) directory.set(ancestor, mark);
    }
  }
  return { file, directory };
}

function TreeEntries({
  entries,
  depth,
  expanded,
  childrenByDir,
  previewPath,
  gitMarks,
  onToggleFolder,
  onPreviewFile,
  directoryStates,
  onRefreshDirectory,
}: {
  entries: FileEntry[];
  depth: number;
  expanded: Set<string>;
  childrenByDir: Record<string, FileEntry[]>;
  previewPath?: string;
  gitMarks: ReturnType<typeof indexGitMarks>;
  onToggleFolder: (path: string) => void;
  onPreviewFile: (path: string) => void;
  directoryStates?: Record<string, DirectoryListing>;
  onRefreshDirectory?: (path: string) => void;
}) {
  return (
    <>
      {entries.map((entry) => {
        const open = expanded.has(entry.path);
        const gitMark = gitMarks[entry.type === "directory" ? "directory" : "file"].get(entry.path);
        const selected = previewPath === entry.path;
        if (entry.type === "directory") {
          const kids = childrenByDir[entry.path];
          return (
            <div key={entry.path} className="codex-tree-group">
              <button
                type="button"
                className="codex-tree-item"
                style={{ paddingLeft: `${0.4 + depth * 0.72}rem` }}
                title={entry.path}
                aria-expanded={open}
                onClick={() => onToggleFolder(entry.path)}
              >
                <span className={`codex-tree-chevron${open ? " open" : ""}`}>
                  {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
                </span>
                <span className="codex-tree-icon">
                  <FolderIcon size={13} />
                </span>
                <span className="codex-tree-name truncate">{entry.name}</span>
                {gitMark ? (
                  <span className="codex-git-badge" title="Changed in the working tree">
                    {gitMark}
                  </span>
                ) : null}
              </button>
              {open ? (
                directoryStates?.[entry.path]?.error ? (
                  <div role="status" className="codex-tree-empty">
                    Could not read folder. <button className="ghost" onClick={() => onRefreshDirectory?.(entry.path)}>Retry</button>
                  </div>
                ) :
                kids && kids.length > 0 ? (
                  <TreeEntries
                    entries={kids}
                    depth={depth + 1}
                    expanded={expanded}
                    childrenByDir={childrenByDir}
                    previewPath={previewPath}
                    gitMarks={gitMarks}
                    onToggleFolder={onToggleFolder}
                    onPreviewFile={onPreviewFile}
                    directoryStates={directoryStates}
                    onRefreshDirectory={onRefreshDirectory}
                  />
                ) : (
                  <div
                    className="codex-tree-empty faint"
                    style={{ paddingLeft: `${1.2 + depth * 0.72}rem` }}
                  >
                    {kids ? "Empty" : "Loading…"}
                  </div>
                )
              ) : null}
            </div>
          );
        }
        return (
          <button
            key={entry.path}
            type="button"
            className={`codex-tree-item${selected ? " active" : ""}`}
            style={{ paddingLeft: `${0.4 + depth * 0.72}rem` }}
            title={entry.path}
            onClick={() => onPreviewFile(entry.path)}
          >
            <span className="codex-tree-chevron" aria-hidden />
            <FileMark name={entry.name} />
            <span className="codex-tree-name truncate">{entry.name}</span>
            {gitMark ? (
              <span className="codex-git-badge" title="Changed in the working tree">
                {gitMark}
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}

export const FileTreePane = memo(function FileTreePane({
  listing,
  expanded,
  childrenByDir,
  searchHits,
  fileSearch,
  overlay,
  folderRoots,
  activeRoot,
  previewPath,
  gitFiles,
  onFileSearchChange,
  onClearSearch,
  onOpenRoot,
  onToggleFolder,
  onPreviewFile,
  directoryStates,
  onRefreshDirectory,
}: {
  listing: FileEntry[];
  expanded: Set<string>;
  childrenByDir: Record<string, FileEntry[]>;
  searchHits: FileEntry[] | null;
  fileSearch: string;
  overlay: boolean;
  folderRoots: string[];
  activeRoot?: string;
  previewPath?: string;
  gitFiles?: GitChange[];
  onFileSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onOpenRoot: (root: string) => void;
  onToggleFolder: (path: string) => void;
  onPreviewFile: (path: string) => void;
  directoryStates?: Record<string, DirectoryListing>;
  onRefreshDirectory?: (path: string) => void;
}) {
  const rootEntries = useMemo(() => sortTreeEntries(listing), [listing]);
  const gitMarks = useMemo(() => indexGitMarks(gitFiles), [gitFiles]);
  return (
    <div className={`codex-file-tree-pane${overlay ? " overlay" : ""}`}>
      <div className="codex-tree-search-wrap">
        <span className="codex-tree-search-icon" aria-hidden>
          <SearchIcon size={14} />
        </span>
        <input
          type="text"
          className="codex-tree-search"
          placeholder="Filter files..."
          value={fileSearch}
          onChange={(event) => onFileSearchChange(event.target.value)}
        />
        {fileSearch ? (
          <button
            type="button"
            className="codex-tree-search-clear"
            onClick={onClearSearch}
            title="Clear filter"
          >
            <XIcon size={11} />
          </button>
        ) : null}
      </div>

      {folderRoots.length > 1 ? (
        <div className="files-roots">
          {folderRoots.map((root) => (
            <button
              key={root}
              type="button"
              className={activeRoot === root ? "active" : ""}
              onClick={() => onOpenRoot(root)}
            >
              {folderBasename(root)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="codex-tree-list">
        {directoryStates?.[""]?.error && <div role="status" className="codex-tree-empty">
          Could not refresh files. <button className="ghost" onClick={() => onRefreshDirectory?.("")}>Retry</button>
        </div>}
        {searchHits ? (
          searchHits.length === 0 ? (
            <div className="codex-tree-empty faint">No matching files</div>
          ) : (
            searchHits.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`codex-tree-item${previewPath === entry.path ? " active" : ""}`}
                title={entry.path}
                onClick={() => onPreviewFile(entry.path)}
              >
                <span className="codex-tree-chevron" aria-hidden />
                <FileMark name={entry.path} />
                <span className="codex-tree-name truncate">{entry.path}</span>
              </button>
            ))
          )
        ) : rootEntries.length === 0 ? (
          <div className="codex-tree-empty faint">Folder is empty</div>
        ) : (
          <TreeEntries
            entries={rootEntries}
            depth={0}
            expanded={expanded}
            childrenByDir={childrenByDir}
            previewPath={previewPath}
            gitMarks={gitMarks}
            onToggleFolder={onToggleFolder}
            onPreviewFile={onPreviewFile}
            directoryStates={directoryStates}
            onRefreshDirectory={onRefreshDirectory}
          />
        )}
      </div>
    </div>
  );
});
