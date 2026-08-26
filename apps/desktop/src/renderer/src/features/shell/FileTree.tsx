import type { FileEntry, GitChange } from "@capsule/shared";
import { folderBasename } from "@capsule/shared";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
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

export function sortTreeEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries]
    .filter((entry) => entry.name !== ".DS_Store" && !HIDDEN_TREE_NAMES.has(entry.name))
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

function gitMarkFor(entry: FileEntry, files?: GitChange[]): string | undefined {
  const hit = files?.find(
    (change) =>
      change.path === entry.path ||
      change.path.endsWith(`/${entry.path}`) ||
      (entry.type === "directory" && change.path.startsWith(`${entry.path}/`)),
  );
  return hit?.code?.trim().charAt(0);
}

function TreeEntries({
  entries,
  depth,
  expanded,
  childrenByDir,
  previewPath,
  gitFiles,
  onToggleFolder,
  onPreviewFile,
}: {
  entries: FileEntry[];
  depth: number;
  expanded: Set<string>;
  childrenByDir: Record<string, FileEntry[]>;
  previewPath?: string;
  gitFiles?: GitChange[];
  onToggleFolder: (path: string) => void;
  onPreviewFile: (path: string) => void;
}) {
  return (
    <>
      {entries.map((entry) => {
        const open = expanded.has(entry.path);
        const gitMark = gitMarkFor(entry, gitFiles);
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
                kids && kids.length > 0 ? (
                  <TreeEntries
                    entries={kids}
                    depth={depth + 1}
                    expanded={expanded}
                    childrenByDir={childrenByDir}
                    previewPath={previewPath}
                    gitFiles={gitFiles}
                    onToggleFolder={onToggleFolder}
                    onPreviewFile={onPreviewFile}
                  />
                ) : (
                  <div
                    className="codex-tree-empty faint"
                    style={{ paddingLeft: `${1.2 + depth * 0.72}rem` }}
                  >
                    {kids ? "Empty" : "…"}
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
            <span className="codex-tree-icon">
              <FileIcon size={13} />
            </span>
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

export function FileTreePane({
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
}) {
  const rootEntries = sortTreeEntries(listing);
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
                <span className="codex-tree-icon">
                  <FileIcon size={13} />
                </span>
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
            gitFiles={gitFiles}
            onToggleFolder={onToggleFolder}
            onPreviewFile={onPreviewFile}
          />
        )}
      </div>
    </div>
  );
}
