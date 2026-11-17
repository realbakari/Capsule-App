import type { FileEntry, GitChange } from "@capsule/shared";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { folderBasename } from "@capsule/shared";
import { copyAnchor, type ActionMenuItem, type MenuAnchor } from "../../lib/action-menu";
import { showNativeContextMenu } from "../../lib/bridge";
import type { DirectoryListing } from "../../lib/directory-listings";
import { FILES_FIND_EVENT } from "../../lib/browser-find";
import { ActionMenu } from "./ActionMenu";
import { FileTypeIcon } from "./FileTypeIcon";
import { isFileRowAction, writeFileRowDrag, type FileRow } from "./file-row-actions";
import type { FileRowActions } from "./useFileRowActions";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  RefreshIcon,
  XIcon,
} from "./icons";

/* Never useful to browse. Everything else the project ignores is listed, dimmed. */
const HIDDEN_TREE_NAMES = new Set([".git", ".DS_Store"]);

export function sortTreeEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries]
    .filter((entry) => !HIDDEN_TREE_NAMES.has(entry.name))
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

/** Search hits laid out as the tree they live in, every folder on the way open. */
export function searchTree(hits: readonly FileEntry[]) {
  const children: Record<string, FileEntry[]> = {};
  const folders = new Set<string>();
  const add = (parent: string, entry: FileEntry) => { (children[parent] ??= []).push(entry); };
  for (const hit of hits) {
    const parts = hit.path.split("/");
    for (let end = 1; end < parts.length; end += 1) {
      const folder = parts.slice(0, end).join("/");
      if (folders.has(folder)) continue;
      folders.add(folder);
      add(parts.slice(0, end - 1).join("/"), { name: parts[end - 1]!, path: folder, type: "directory" });
    }
    add(parts.slice(0, -1).join("/"), { name: parts.at(-1)!, path: hit.path, type: "file" });
  }
  for (const key of Object.keys(children)) children[key] = sortTreeEntries(children[key]!);
  return { roots: children[""] ?? [], children, folders };
}

const ROW = "[data-tree-row]";

/*
 * Arrow keys walk the rows as they are drawn: up and down move, right opens a
 * folder or steps into it, left closes it or steps out to its parent.
 */
function walkTree(event: KeyboardEvent<HTMLDivElement>, onToggleFolder: (path: string) => void) {
  const row = (event.target as HTMLElement).closest<HTMLElement>(ROW);
  if (!row || event.metaKey || event.ctrlKey || event.altKey) return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW));
  const index = rows.indexOf(row);
  const path = row.dataset.path ?? "";
  const folder = row.dataset.kind === "directory";
  const open = row.getAttribute("aria-expanded") === "true";
  let target: HTMLElement | undefined;
  switch (event.key) {
    case "ArrowDown": target = rows[index + 1]; break;
    case "ArrowUp": target = rows[index - 1]; break;
    case "Home": target = rows[0]; break;
    case "End": target = rows.at(-1); break;
    case "ArrowRight":
      if (!folder) return;
      if (!open) onToggleFolder(path);
      else target = rows[index + 1]?.dataset.path?.startsWith(`${path}/`) ? rows[index + 1] : undefined;
      break;
    case "ArrowLeft": {
      if (folder && open) { onToggleFolder(path); break; }
      const parent = path.slice(0, path.lastIndexOf("/"));
      target = parent ? rows.find((candidate) => candidate.dataset.path === parent) : undefined;
      break;
    }
    default: return;
  }
  event.preventDefault();
  target?.focus();
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
  expanded: ReadonlySet<string>;
  childrenByDir: Record<string, FileEntry[]>;
  previewPath?: string;
  gitMarks: ReturnType<typeof indexGitMarks>;
  onToggleFolder: (path: string) => void;
  onPreviewFile: (path: string) => void;
  directoryStates?: Record<string, DirectoryListing>;
  onRefreshDirectory?: (path: string) => void;
}) {
  const indent = { paddingLeft: `${0.375 + depth * 0.875}rem` };
  return (
    <>
      {entries.map((entry) => {
        const open = expanded.has(entry.path);
        const gitMark = gitMarks[entry.type === "directory" ? "directory" : "file"].get(entry.path);
        const badge = gitMark ? <span className="panel-git-badge" title="Changed in the working tree">{gitMark}</span> : null;
        const ignored = entry.ignored ? " ignored" : "";
        if (entry.type === "directory") {
          const kids = childrenByDir[entry.path];
          return (
            <div key={entry.path} className="panel-tree-group">
              <button
                type="button"
                className={`panel-tree-item${ignored}`}
                style={indent}
                title={entry.ignored ? `${entry.path} (ignored)` : entry.path}
                aria-expanded={open}
                data-tree-row
                data-kind="directory"
                data-path={entry.path}
                draggable
                onClick={() => onToggleFolder(entry.path)}
              >
                <span className="panel-tree-chevron" aria-hidden>
                  {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                </span>
                <span className="panel-tree-name truncate">{entry.name}</span>
                {badge}
              </button>
              {open ? (
                directoryStates?.[entry.path]?.error ? (
                  <div role="status" className="panel-tree-empty" style={{ paddingLeft: `${1.375 + depth * 0.875}rem` }}>
                    Could not read folder. <button className="ghost" onClick={() => onRefreshDirectory?.(entry.path)}>Retry</button>
                  </div>
                ) : kids && kids.length > 0 ? (
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
                  <div className="panel-tree-empty faint" style={{ paddingLeft: `${1.375 + depth * 0.875}rem` }}>
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
            className={`panel-tree-item${previewPath === entry.path ? " active" : ""}${ignored}`}
            style={indent}
            title={entry.ignored ? `${entry.path} (ignored)` : entry.path}
            aria-current={previewPath === entry.path ? "true" : undefined}
            data-tree-row
            data-kind="file"
            data-path={entry.path}
            draggable
            onClick={() => onPreviewFile(entry.path)}
          >
            <span className="panel-tree-chevron" aria-hidden />
            <FileTypeIcon name={entry.name} />
            <span className="panel-tree-name truncate">{entry.name}</span>
            {badge}
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
  searchLoading,
  searchError,
  onRetrySearch,
  fileSearch,
  folderRoots,
  activeRoot,
  previewPath,
  gitFiles,
  refreshing,
  onRefresh,
  onExpandAll,
  onCollapseAll,
  onFileSearchChange,
  onClearSearch,
  onOpenRoot,
  onToggleFolder,
  onPreviewFile,
  directoryStates,
  onRefreshDirectory,
  rowActions,
}: {
  listing: FileEntry[];
  expanded: Set<string>;
  childrenByDir: Record<string, FileEntry[]>;
  searchHits: FileEntry[] | null;
  searchLoading?: boolean;
  searchError?: string;
  onRetrySearch?: () => void;
  fileSearch: string;
  folderRoots: string[];
  activeRoot?: string;
  previewPath?: string;
  gitFiles?: GitChange[];
  refreshing?: boolean;
  onRefresh: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onFileSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onOpenRoot: (root: string) => void;
  onToggleFolder: (path: string) => void;
  onPreviewFile: (path: string) => void;
  directoryStates?: Record<string, DirectoryListing>;
  onRefreshDirectory?: (path: string) => void;
  /** Absent, rows have no menu. */
  rowActions?: FileRowActions;
}) {
  const rootEntries = useMemo(() => sortTreeEntries(listing), [listing]);
  const gitMarks = useMemo(() => indexGitMarks(gitFiles), [gitFiles]);
  const found = useMemo(() => (searchHits ? searchTree(searchHits) : undefined), [searchHits]);
  // Folders closed by hand while a search shows; a new query opens them all again.
  const [searchClosed, setSearchClosed] = useState<{ query: string; paths: Set<string> }>();
  const closedNow = searchClosed?.query === fileSearch ? searchClosed.paths : undefined;
  const searchOpen = useMemo(
    () => new Set([...(found?.folders ?? [])].filter((path) => !closedNow?.has(path))),
    [found, closedNow],
  );
  const toggleSearchFolder = (path: string) => {
    const paths = new Set(closedNow);
    if (paths.has(path)) paths.delete(path);
    else paths.add(path);
    setSearchClosed({ query: fileSearch, paths });
  };

  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = () => { searchInput.current?.focus(); searchInput.current?.select(); };
    window.addEventListener(FILES_FIND_EVENT, focusSearch);
    return () => window.removeEventListener(FILES_FIND_EVENT, focusSearch);
  }, []);

  const [rowMenu, setRowMenu] = useState<{ row: FileRow; element: HTMLElement; items: ActionMenuItem[]; point: { x: number; y: number }; anchor?: MenuAnchor; keyboard: boolean }>();
  const rowAt = (target: EventTarget | null): { element: HTMLElement; row: FileRow } | undefined => {
    const element = target instanceof Element ? target.closest<HTMLElement>(ROW) : null;
    const path = element?.dataset.path;
    if (!element || !path || !activeRoot) return undefined;
    return { element, row: { root: activeRoot, path, kind: element.dataset.kind === "directory" ? "directory" : "file" } };
  };
  /* A pointer gets the system menu; the keyboard gets the in-app one, anchored to the row and focused. */
  const openRowMenu = async (event: { target: EventTarget | null; preventDefault(): void; clientX?: number; clientY?: number }, keyboard: boolean) => {
    const hit = rowAt(event.target);
    if (!rowActions || !hit) return;
    event.preventDefault();
    const items = rowActions.items(hit.row.kind);
    const rect = hit.element.getBoundingClientRect();
    const pointer = !keyboard && (event.clientX || event.clientY);
    const point = pointer ? { x: event.clientX!, y: event.clientY! } : { x: rect.left, y: rect.bottom };
    hit.element.dataset.menuOpen = "";
    if (!keyboard) {
      const picked = await showNativeContextMenu(items, point);
      if (picked !== "unavailable") {
        delete hit.element.dataset.menuOpen;
        if (picked && isFileRowAction(picked)) rowActions.run(picked, hit.row);
        return;
      }
    }
    setRowMenu({ ...hit, items, point, anchor: pointer ? undefined : copyAnchor(rect), keyboard: keyboard || !pointer });
  };
  const closeRowMenu = () => {
    if (!rowMenu) return;
    delete rowMenu.element.dataset.menuOpen;
    if (rowMenu.element.isConnected) rowMenu.element.focus({ preventScroll: true });
    setRowMenu(undefined);
  };

  const anyOpen = expanded.size > 0;
  const hasFolders = rootEntries.some((entry) => entry.type === "directory");
  const rootState = directoryStates?.[""];

  return (
    <div className="panel-file-tree-pane">
      <div className="panel-tree-head">
        <button
          type="button"
          className="icon-btn panel-tree-head-btn"
          aria-label="Refresh files"
          title={refreshing ? "Refreshing…" : "Refresh files"}
          aria-busy={refreshing || undefined}
          onClick={onRefresh}
        >
          <RefreshIcon size={13} className={refreshing ? "panel-tree-refreshing" : undefined} />
        </button>
        <div className="panel-tree-search-wrap">
          <input
            ref={searchInput}
            type="search"
            className="panel-tree-search"
            aria-label="Search files"
            placeholder="Search files"
            spellCheck={false}
            value={fileSearch}
            onChange={(event) => onFileSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              onClearSearch();
              event.currentTarget.blur();
            }}
          />
          {fileSearch ? (
            <button type="button" className="panel-tree-search-clear" onClick={onClearSearch} aria-label="Clear search" title="Clear search">
              <XIcon size={11} />
            </button>
          ) : null}
        </div>
        {hasFolders && !searchHits ? (
          <button
            type="button"
            className="icon-btn panel-tree-head-btn"
            aria-label={anyOpen ? "Collapse all folders" : "Expand all folders"}
            title={anyOpen ? "Collapse all folders" : "Expand all folders"}
            onClick={anyOpen ? onCollapseAll : onExpandAll}
          >
            {anyOpen ? <ChevronsDownUpIcon size={13} /> : <ChevronsUpDownIcon size={13} />}
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

      <div
        className="panel-tree-list"
        aria-label="Files"
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) void openRowMenu(event, true);
          else walkTree(event, found ? toggleSearchFolder : onToggleFolder);
        }}
        onContextMenu={(event) => void openRowMenu(event, false)}
        onDragStart={(event) => {
          const hit = rowAt(event.target);
          if (hit) writeFileRowDrag(event.dataTransfer, hit.row);
        }}
      >
        {rootState?.error && <div role="status" className="panel-tree-empty">
          Could not refresh files. <button className="ghost" onClick={() => onRefreshDirectory?.("")}>Retry</button>
        </div>}
        {searchLoading ? <div className="panel-tree-empty faint" role="status">Searching…</div>
          : searchError ? <div className="panel-tree-empty" role="alert">Could not search files. {searchError} <button className="ghost" onClick={onRetrySearch}>Retry</button></div>
          : found ? (
            found.roots.length === 0 ? (
              <div className="panel-tree-empty faint" role="status">No matching files</div>
            ) : (
              <TreeEntries
                entries={found.roots}
                depth={0}
                expanded={searchOpen}
                childrenByDir={found.children}
                previewPath={previewPath}
                gitMarks={gitMarks}
                onToggleFolder={toggleSearchFolder}
                onPreviewFile={onPreviewFile}
              />
            )
          ) : rootEntries.length === 0 ? (
            rootState?.error ? null : (
              <div className="panel-tree-empty faint" role="status">
                {rootState?.loading || !rootState ? "Loading files…" : "Folder is empty"}
              </div>
            )
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
      {rowMenu && (
        <ActionMenu
          items={rowMenu.items}
          point={rowMenu.point}
          anchor={rowMenu.anchor}
          keyboard={rowMenu.keyboard}
          onClose={closeRowMenu}
          onSelect={(action) => {
            closeRowMenu();
            if (isFileRowAction(action)) rowActions?.run(action, rowMenu.row);
          }}
        />
      )}
    </div>
  );
});
