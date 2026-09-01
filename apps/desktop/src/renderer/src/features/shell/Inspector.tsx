import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { FileEntry, FilePreview } from "@capsule/shared";
import { folderBasename, projectFolderList } from "@capsule/shared";
import { FileSaveCoordinator, isConflictError } from "../../lib/file-save";
import { formatProjectRoot } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { DiffView } from "./DiffView";
import { FilePreviewView } from "./FilePreview";
import { FileTreePane, sortTreeEntries } from "./FileTree";
import {
  ColumnsIcon,
  CpuIcon,
  DiffIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  MaximizeIcon,
  MessageSquarePlusIcon,
  MinimizeIcon,
  PanelRightIcon,
  PlusIcon,
  TerminalIcon,
  XIcon,
} from "./icons";

/** Bump when the inspector shell changes so a stuck error panel remounts. */
export const INSPECTOR_REVISION = 2;

type InspectorTool = "launcher" | "review" | "terminal" | "browser" | "files" | "chat";

function toolFromTab(tab: string): InspectorTool {
  if (tab === "term") return "terminal";
  if (tab === "changes" || tab === "diff") return "review";
  if (tab === "agents" || tab === "run") return "chat";
  if (tab === "browser") return "browser";
  if (tab === "files" || tab === "preview") return "files";
  return "launcher";
}

function toolTitle(tool: InspectorTool, fileName?: string): string {
  if (tool === "files") return fileName || "Open file";
  if (tool === "review") return "Review";
  if (tool === "terminal") return "Terminal";
  if (tool === "browser") return "Browser";
  if (tool === "chat") return "Side chat";
  return "Launch";
}

interface OpenTabItem {
  id: InspectorTool;
  title: string;
  subTitle?: string;
}

const TOOL_SHORTCUTS: Record<InspectorTool, string> = {
  launcher: "",
  review: "⌃⇧G",
  terminal: "⌃`",
  browser: "",
  files: "",
  chat: "⌥⌘S",
};

export function Inspector() {
  const {
    project,
    session,
    activeRun,
    steps,
    artifacts,
    harnesses: harnessList,
    harnessSessions,
    git,
    files,
    pickProjectDirectory,
    openTerminal,
    execInProject,
    openPath,
    mentionFile,
    setView,
    toggleInspector,
    setInspectorOpen,
    api,
    projectId,
    inspectorTab,
    setInspectorTab,
    gitCommit,
    gitStage,
    gitDiscard,
    gitPush,
    gitCreatePullRequest,
    gitMergePullRequest,
    settings,
    spawnHarness,
    cancelHarness,
    closeHarness,
    setSessionId,
    busy,
  } = useWorkspace();

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem("capsule.inspectorWidth"));
      return Number.isFinite(saved) && saved >= 360 && saved <= 1200 ? saved : 520;
    } catch {
      return 520;
    }
  });
  const [isMaximized, setIsMaximized] = useState(false);
  const [showTree, setShowTree] = useState(true);

  const [activeTool, setActiveTool] = useState<InspectorTool>(() => toolFromTab(inspectorTab));
  const [openTabs, setOpenTabs] = useState<OpenTabItem[]>(() => {
    const tool = toolFromTab(inspectorTab);
    return tool === "launcher" ? [] : [{ id: tool, title: toolTitle(tool) }];
  });

  const [fileRoot, setFileRoot] = useState<string>();
  const [listing, setListing] = useState<FileEntry[]>(files);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [childrenByDir, setChildrenByDir] = useState<Record<string, FileEntry[]>>({});
  const [fileSearch, setFileSearch] = useState("");
  const [searchHits, setSearchHits] = useState<FileEntry[] | null>(null);
  const [diff, setDiff] = useState("");
  const [preview, setPreview] = useState("");
  const [previewDoc, setPreviewDoc] = useState<FilePreview>();
  const [previewEditing, setPreviewEditing] = useState(false);
  const [editing, setEditing] = useState<{ path: string; truncated: boolean; revision: string }>();
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error" | "truncated" | "conflict"
  >("idle");
  const saverRef = useRef<FileSaveCoordinator | undefined>(undefined);
  const revisionRef = useRef<string | undefined>(undefined);

  const [browserUrl, setBrowserUrl] = useState("http://localhost:3000");

  const [termCmd, setTermCmd] = useState("");
  const [termOut, setTermOut] = useState("");
  const [termBusy, setTermBusy] = useState(false);

  const [message, setMessage] = useState("");

  const harnesses = harnessList ?? [];
  const dedicated = harnesses.find((item) => item.id === project?.defaultAgentId);

  const folderRoots = projectFolderList(project ?? {});
  const activeRoot =
    (fileRoot &&
      folderRoots.find((root) => root.toLowerCase() === fileRoot.toLowerCase())) ||
    project?.workingDirectory;

  useEffect(() => {
    const previous = saverRef.current;
    previous?.dispose();
    revisionRef.current = editing?.revision;
    if (!editing || !projectId) {
      saverRef.current = undefined;
      return;
    }
    const path = editing.path;
    saverRef.current = new FileSaveCoordinator({
      debounceMs: 600,
      persist: async (contents) => {
        setSaveState("saving");
        const written = await api.writeFile(projectId, path, contents, {
          origin: "user",
          expectedRevision: revisionRef.current,
          root: fileRoot,
        });
        revisionRef.current = written?.revision;
      },
      onSaved: () => setSaveState("saved"),
      onError: (error) => setSaveState(isConflictError(error) ? "conflict" : "error"),
    });
    return () => saverRef.current?.dispose();
  }, [api, editing, fileRoot, projectId]);

  useEffect(() => {
    setFileRoot(project?.workingDirectory);
    setListing(files);
  }, [files, project?.workingDirectory, projectId]);

  useEffect(() => {
    setExpanded(new Set());
    setChildrenByDir({});
  }, [projectId, project?.workingDirectory]);

  useEffect(() => {
    setPreviewDoc(undefined);
    setPreviewEditing(false);
    setEditing(undefined);
    setPreview("");
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !activeRoot) {
      setListing(files);
      return;
    }
    let ignore = false;
    api
      .listFiles(projectId, undefined, activeRoot)
      .then((entries) => {
        if (!ignore) setListing(entries);
      })
      .catch(() => {
        if (!ignore) setListing([]);
      });
    return () => {
      ignore = true;
    };
  }, [activeRoot, api, files, projectId]);

  useEffect(() => {
    const query = fileSearch.trim();
    if (!projectId || query.length < 2) {
      setSearchHits(null);
      return;
    }
    let ignore = false;
    void api
      .searchFiles(projectId, query, activeRoot)
      .then((hits) => {
        if (!ignore) setSearchHits(hits);
      })
      .catch(() => {
        if (!ignore) setSearchHits([]);
      });
    return () => {
      ignore = true;
    };
  }, [activeRoot, api, fileSearch, projectId]);

  function selectTool(tool: InspectorTool) {
    setActiveTool(tool);
    if (tool !== "launcher") {
      setOpenTabs((current) => {
        if (current.some((tab) => tab.id === tool)) return current;
        return [
          ...current,
          {
            id: tool,
            title: toolTitle(tool, previewDoc ? folderBasename(previewDoc.path) : undefined),
          },
        ];
      });
    }
    if (tool === "terminal") setInspectorTab("term");
    else if (tool === "review") setInspectorTab("changes");
    else if (tool === "files") setInspectorTab(previewDoc ? "preview" : "files");
    else if (tool === "chat") setInspectorTab("agents");
    else if (tool === "browser") setInspectorTab("browser");
    else setInspectorTab("launcher");
  }

  useEffect(() => {
    const next = toolFromTab(inspectorTab);
    setActiveTool((current) => (current === next ? current : next));
    if (next === "launcher") return;
    setOpenTabs((current) => {
      if (current.some((tab) => tab.id === next)) return current;
      return [...current, { id: next, title: toolTitle(next) }];
    });
  }, [inspectorTab]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        Boolean(event.target.closest("input, textarea, select, [contenteditable]"));
      if (typing) return;
      if (event.ctrlKey && event.shiftKey && event.code === "KeyG") {
        event.preventDefault();
        selectTool("review");
      } else if (event.ctrlKey && (event.key === "`" || event.code === "Backquote")) {
        event.preventDefault();
        selectTool("terminal");
      } else if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === "KeyS") {
        event.preventDefault();
        selectTool("chat");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function closeTab(id: InspectorTool) {
    const nextTabs = openTabs.filter((tab) => tab.id !== id);
    setOpenTabs(nextTabs);
    if (activeTool !== id) return;
    const last = nextTabs[nextTabs.length - 1];
    if (last) selectTool(last.id);
    else {
      setActiveTool("launcher");
      setInspectorTab("launcher");
    }
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const origin = event.clientX;
    const start = panelWidth;
    const move = (next: PointerEvent) => {
      const nextWidth = Math.max(340, Math.min(1080, start + (origin - next.clientX)));
      setPanelWidth(nextWidth);
      try {
        localStorage.setItem("capsule.inspectorWidth", String(nextWidth));
      } catch {
        // ignore
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  async function openRoot(root: string) {
    setFileRoot(root);
    setExpanded(new Set());
    setChildrenByDir({});
  }

  function toggleFolder(path: string) {
    const closing = expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (closing) next.delete(path);
      else next.add(path);
      return next;
    });
    if (closing || childrenByDir[path] || !projectId) return;
    void api
      .listFiles(projectId, path, activeRoot)
      .then((entries) => {
        setChildrenByDir((current) => ({ ...current, [path]: sortTreeEntries(entries) }));
      })
      .catch(() => {
        setChildrenByDir((current) => ({ ...current, [path]: [] }));
      });
  }

  async function previewFile(relative: string) {
    if (!projectId) return;
    try {
      const doc = await api.previewFile(projectId, relative, activeRoot);
      setPreviewDoc(doc);
      setPreview(doc.contents ?? "");
      setPreviewEditing(false);
      setEditing(
        doc.kind === "text" && !doc.truncated && Boolean(doc.revision)
          ? {
              path: relative,
              truncated: false,
              revision: doc.revision ?? "",
            }
          : undefined,
      );
      setSaveState(doc.truncated ? "truncated" : "idle");
      setDiff("");

      setOpenTabs((current) => {
        const withoutFiles = current.filter((t) => t.id !== "files");
        return [
          ...withoutFiles,
          {
            id: "files",
            title: folderBasename(relative) || "Open file",
            subTitle: relative,
          },
        ];
      });
    } catch (error) {
      setPreviewDoc({
        path: relative,
        kind: "binary",
        truncated: false,
        size: 0,
        detail: error instanceof Error ? error.message : String(error),
      });
      setEditing(undefined);
      setSaveState("idle");
    }
    setActiveTool("files");
    setInspectorOpen(true);
  }

  async function showFileDiff(relative: string) {
    if (!projectId) return;
    try {
      const text = await api.gitDiff(projectId, relative);
      setDiff(text || "(no differences)");
    } catch {
      setDiff("Failed to load diff.");
    }
    setPreviewDoc(undefined);
    setEditing(undefined);
    selectTool("review");
    setInspectorOpen(true);
  }

  const renderToolIcon = (tool: InspectorTool) => {
    switch (tool) {
      case "review":
        return <DiffIcon size={14} />;
      case "terminal":
        return <TerminalIcon size={14} />;
      case "browser":
        return <GlobeIcon size={14} />;
      case "files":
        return <FileIcon size={14} />;
      case "chat":
        return <MessageSquarePlusIcon size={14} />;
      default:
        return <FileIcon size={14} />;
    }
  };

  return (
    <aside
      className={`inspector codex-inspector${isMaximized ? " maximized" : ""}`}
      style={!isMaximized ? { width: `${panelWidth}px` } : undefined}
    >
      <div className="inspector-rail" onPointerDown={startResize} title="Drag to resize pane" />

      <div className="codex-tab-bar">
        <div className="codex-tabs-list">
          {openTabs.map((tabItem) => (
            <div
              key={tabItem.id}
              className={`codex-tab${activeTool === tabItem.id ? " active" : ""}`}
            >
              <button
                type="button"
                className="codex-tab-main"
                onClick={() => selectTool(tabItem.id)}
              >
                <span className="codex-tab-icon">{renderToolIcon(tabItem.id)}</span>
                <span className="codex-tab-title">{tabItem.title}</span>
              </button>
              <button
                type="button"
                className="codex-tab-close"
                title="Close tab"
                aria-label={`Close ${tabItem.title}`}
                onClick={() => closeTab(tabItem.id)}
              >
                <XIcon size={11} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={`codex-tab-add${activeTool === "launcher" ? " active" : ""}`}
            title="Open tools"
            onClick={() => selectTool("launcher")}
          >
            <PlusIcon size={13} />
          </button>
        </div>

        <div className="codex-chrome-actions">
          <button
            type="button"
            className="icon-btn"
            title={isMaximized ? "Restore standard size" : "Maximize panel"}
            aria-label={isMaximized ? "Restore standard size" : "Maximize panel"}
            onClick={() => setIsMaximized((prev) => !prev)}
          >
            {isMaximized ? <MinimizeIcon size={13} /> : <MaximizeIcon size={13} />}
          </button>
          {activeTool === "files" && (
            <button
              type="button"
              className={`icon-btn${showTree ? " active" : ""}`}
              title="Toggle workspace tree"
              aria-label="Toggle workspace tree"
              onClick={() => setShowTree((prev) => !prev)}
            >
              <ColumnsIcon size={13} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            title="Close inspector (⌘\\)"
            aria-label="Close inspector (⌘\\)"
            onClick={toggleInspector}
          >
            <PanelRightIcon size={14} />
          </button>
        </div>
      </div>

      {activeTool !== "launcher" ? (
      <div className="codex-sub-bar">
        <span className="codex-breadcrumb truncate">
          {activeTool === "files" ? (
            <>
              <span className="codex-breadcrumb-slash">/</span>
              {activeRoot ? (
                <span className="codex-breadcrumb-root">{folderBasename(activeRoot)}</span>
              ) : (
                <span>workspace</span>
              )}
              {previewDoc?.path?.includes("/") ? (
                <span className="codex-breadcrumb-dir">
                  /{previewDoc.path.split("/").slice(0, -1).join("/")}
                </span>
              ) : null}
              {previewDoc?.path ? (
                <span className="codex-breadcrumb-file">/{folderBasename(previewDoc.path)}</span>
              ) : null}
            </>
          ) : activeTool === "review" ? (
            <>
              <span>Git</span>
              <span className="codex-breadcrumb-sep">·</span>
              <span className="mono">{git?.branch ?? "main"}</span>
              {git?.changed ? (
                <span className="codex-breadcrumb-count">{git.changed} changed</span>
              ) : null}
            </>
          ) : activeTool === "terminal" ? (
            <>
              <span>Terminal</span>
              <span className="codex-breadcrumb-sep">·</span>
              <span className="mono truncate">
                {project?.workingDirectory
                  ? formatProjectRoot(project.workingDirectory, { home: window.capsule.homeDir })
                  : "local"}
              </span>
            </>
          ) : activeTool === "browser" ? (
            <>
              <span>Browser</span>
              <span className="codex-breadcrumb-sep">·</span>
              <span className="truncate">{browserUrl}</span>
            </>
          ) : activeTool === "chat" ? (
            <>
              <span>Side chat</span>
              <span className="codex-breadcrumb-sep">·</span>
              <span>{dedicated?.name ?? "ACP Agents"}</span>
            </>
          ) : (
            <span>Quick launch</span>
          )}
        </span>
      </div>
      ) : null}

      <div className="codex-inspector-content">
        {activeTool === "launcher" && (
          <div className="codex-launcher">
            <div className="codex-launcher-cards">
              <button
                type="button"
                className="codex-launcher-card squish-click"
                onClick={() => selectTool("review")}
              >
                <span className="codex-launcher-lead">
                  <span className="codex-launcher-icon">
                    <DiffIcon size={16} />
                  </span>
                  <span className="codex-launcher-label">Review</span>
                </span>
                {TOOL_SHORTCUTS.review ? (
                  <kbd className="codex-launcher-kbd">{TOOL_SHORTCUTS.review}</kbd>
                ) : null}
              </button>

              <button
                type="button"
                className="codex-launcher-card squish-click"
                onClick={() => selectTool("terminal")}
              >
                <span className="codex-launcher-lead">
                  <span className="codex-launcher-icon">
                    <TerminalIcon size={16} />
                  </span>
                  <span className="codex-launcher-label">Terminal</span>
                </span>
                {TOOL_SHORTCUTS.terminal ? (
                  <kbd className="codex-launcher-kbd">{TOOL_SHORTCUTS.terminal}</kbd>
                ) : null}
              </button>

              <button
                type="button"
                className="codex-launcher-card squish-click"
                onClick={() => selectTool("browser")}
              >
                <span className="codex-launcher-lead">
                  <span className="codex-launcher-icon">
                    <GlobeIcon size={16} />
                  </span>
                  <span className="codex-launcher-label">Browser</span>
                </span>
              </button>

              <button
                type="button"
                className="codex-launcher-card squish-click"
                onClick={() => selectTool("files")}
              >
                <span className="codex-launcher-lead">
                  <span className="codex-launcher-icon">
                    <FolderIcon size={16} />
                  </span>
                  <span className="codex-launcher-label">Files</span>
                </span>
              </button>

              <button
                type="button"
                className="codex-launcher-card squish-click"
                onClick={() => selectTool("chat")}
              >
                <span className="codex-launcher-lead">
                  <span className="codex-launcher-icon">
                    <MessageSquarePlusIcon size={16} />
                  </span>
                  <span className="codex-launcher-label">Side chat</span>
                </span>
                {TOOL_SHORTCUTS.chat ? (
                  <kbd className="codex-launcher-kbd">{TOOL_SHORTCUTS.chat}</kbd>
                ) : null}
              </button>
            </div>
          </div>
        )}

        {activeTool === "files" && (
          <div className="codex-files-workspace">
            <div className="codex-file-preview-pane">
              {previewDoc ? (
                <FilePreviewView
                  doc={previewEditing ? { ...previewDoc, contents: preview } : previewDoc}
                  editing={previewEditing}
                  contents={preview}
                  saveState={saveState}
                  onChange={(value) => {
                    setPreview(value);
                    saverRef.current?.change(value);
                  }}
                  onMention={() => {
                    const prefix =
                      activeRoot && activeRoot !== project?.workingDirectory
                        ? `${folderBasename(activeRoot)}/`
                        : "";
                    mentionFile(`${prefix}${previewDoc.path}`);
                  }}
                  onOpen={() => {
                    if (!activeRoot) return;
                    void openPath(`${activeRoot.replace(/\/$/, "")}/${previewDoc.path}`);
                  }}
                  onEdit={() => setPreviewEditing(true)}
                  onView={() => {
                    void saverRef.current?.flush();
                    setPreviewEditing(false);
                    setPreviewDoc((current) =>
                      current?.kind === "text" ? { ...current, contents: preview } : current,
                    );
                  }}
                  onReload={() => void previewFile(previewDoc.path)}
                  onOverwrite={() => {
                    revisionRef.current = undefined;
                    void saverRef.current?.flush();
                  }}
                />
              ) : (
                <div className="codex-empty-file-state">
                  <div className="codex-empty-file-icon" aria-hidden>
                    <FileIcon size={46} />
                  </div>
                  <h3>Open file</h3>
                  <p>Select a file from the workspace tree</p>
                  {!activeRoot && (
                    <div className="actions" style={{ marginTop: 14 }}>
                      <button className="send-btn-pill" onClick={() => void pickProjectDirectory()}>
                        Attach folder
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {showTree ? (
              <FileTreePane
                listing={listing}
                expanded={expanded}
                childrenByDir={childrenByDir}
                searchHits={searchHits}
                fileSearch={fileSearch}
                overlay={panelWidth < 480}
                folderRoots={folderRoots}
                activeRoot={activeRoot}
                previewPath={previewDoc?.path}
                gitFiles={git?.files}
                onFileSearchChange={setFileSearch}
                onClearSearch={() => setFileSearch("")}
                onOpenRoot={(root) => void openRoot(root)}
                onToggleFolder={toggleFolder}
                onPreviewFile={(path) => void previewFile(path)}
              />
            ) : null}
          </div>
        )}

        {activeTool === "review" && (
          <div className="codex-tool-pane">
            <div className="codex-review-header">
              <div className="kv">
                <span>Branch</span>
                <span className="mono">{git?.branch ?? "main"}</span>
              </div>
              <div className="git-actions">
                <button className="chip" type="button" onClick={() => void gitPush()}>
                  Push
                </button>
                {git?.pullRequest && git.pullRequest.state === "OPEN" ? (
                  <button className="chip" type="button" onClick={() => void gitMergePullRequest()}>
                    Merge PR
                  </button>
                ) : (
                  <button
                    className="chip"
                    type="button"
                    disabled={git?.ghAvailable === false}
                    title={
                      git?.ghAvailable === false
                        ? "The GitHub CLI (gh) is not installed or not signed in."
                        : undefined
                    }
                    onClick={() => void gitCreatePullRequest()}
                  >
                    {settings?.prDraft ? "Draft PR" : "Pull request"}
                  </button>
                )}
              </div>
            </div>

            <div className="codex-review-files">
              <h4>Changed Files ({git?.files?.length ?? 0})</h4>
              {(git?.files ?? []).length === 0 ? (
                <p className="faint">Working tree clean.</p>
              ) : (
                git?.files?.map((entry) => (
                  <div className="change-row" key={entry.path}>
                    <button className="list-item" onClick={() => void showFileDiff(entry.path)}>
                      <DiffIcon size={12} />
                      <span className="truncate">{entry.path}</span>
                      <span className="meta">{entry.code}</span>
                    </button>
                    <button className="ghost" onClick={() => void gitStage(entry.path)}>
                      Stage
                    </button>
                    <button className="danger" onClick={() => gitDiscard(entry.path)}>
                      Discard
                    </button>
                  </div>
                ))
              )}
            </div>

            {git?.isRepo && (
              <form
                className="commit-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!message.trim()) return;
                  void gitCommit(message).then(() => setMessage(""));
                }}
              >
                <input
                  type="text"
                  placeholder="Commit message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
                <button
                  className="send"
                  type="submit"
                  disabled={!git?.dirty || !message.trim()}
                  title={
                    !git?.dirty
                      ? "Nothing to commit — the working tree is clean."
                      : !message.trim()
                        ? "Write a commit message first."
                        : undefined
                  }
                >
                  Commit
                </button>
              </form>
            )}

            <div className="codex-diff-section">
              <h4>Diff</h4>
              {diff ? (
                <DiffView text={diff} />
              ) : (
                artifacts
                  .filter((item) => item.kind === "patch" && item.content)
                  .map((artifact) => (
                    <div key={artifact.id}>
                      <h5>{artifact.title}</h5>
                      <DiffView text={artifact.content ?? ""} />
                    </div>
                  ))
              )}
              {!diff && artifacts.every((item) => item.kind !== "patch" || !item.content) && (
                <p className="faint">Select a changed file to view its git diff.</p>
              )}
            </div>
          </div>
        )}

        {activeTool === "terminal" && (
          <div className="codex-terminal-pane">
            <div className="codex-terminal-top">
              <span className="faint">Runs inside project folder.</span>
              <button
                className="chip"
                type="button"
                disabled={!projectId}
                title={!projectId ? "Open a project first — there is no folder to run in." : undefined}
                onClick={() => void openTerminal()}
              >
                Open Terminal.app
              </button>
            </div>
            <pre className="mono term-out codex-term-output">{termOut || "$ echo 'Capsule terminal ready'"}</pre>
            <form
              className="term-form"
              onSubmit={(event) => {
                event.preventDefault();
                const command = termCmd.trim();
                if (!command || termBusy) return;
                setTermBusy(true);
                setTermOut((current) => `${current && current !== "$" ? `${current}\n` : ""}$ ${command}\n`);
                void execInProject(command)
                  .then((result) => {
                    const body = `${result.stdout}${result.stderr}`.trim();
                    setTermOut((current) => `${current}${body ? `${body}\n` : ""}exit ${result.code}`);
                  })
                  .catch((error) => {
                    setTermOut((current) => `${current}${error instanceof Error ? error.message : String(error)}`);
                  })
                  .finally(() => setTermBusy(false));
                setTermCmd("");
              }}
            >
              <span className="faint">$</span>
              <input
                type="text"
                value={termCmd}
                placeholder={project?.workingDirectory ? "e.g. git status, pnpm test" : "Choose a folder first"}
                disabled={!projectId || termBusy}
                onChange={(event) => setTermCmd(event.target.value)}
              />
              <button className="chip" disabled={!termCmd.trim() || termBusy} type="submit">
                Run
              </button>
            </form>
          </div>
        )}

        {activeTool === "browser" && (
          <div className="codex-browser-pane">
            <div className="codex-browser-nav">
              <input
                type="text"
                className="codex-browser-input"
                value={browserUrl}
                onChange={(e) => setBrowserUrl(e.target.value)}
                placeholder="https://..."
              />
              <button
                type="button"
                className="chip"
                onClick={() => void openPath(browserUrl)}
              >
                Open in Browser
              </button>
            </div>
            <div className="codex-browser-links">
              <h4>Quick Links</h4>
              <div className="actions" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setBrowserUrl("http://localhost:3000");
                    void openPath("http://localhost:3000");
                  }}
                >
                  Localhost (3000)
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setBrowserUrl("http://localhost:5173");
                    void openPath("http://localhost:5173");
                  }}
                >
                  Vite Dev Server (5173)
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setBrowserUrl("https://docs.openclaw.ai");
                    void openPath("https://docs.openclaw.ai");
                  }}
                >
                  OpenClaw Documentation
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTool === "chat" && (
          <div className="codex-tool-pane">
            <div className="inspector-block">
              <h4>ACP Harness Agents</h4>
              {harnesses.map((harness) => (
                <div className="change-row" key={harness.id}>
                  <div className="list-item" style={{ cursor: "default" }}>
                    <CpuIcon size={12} />
                    <span className="truncate">{harness.name}</span>
                    <span className="meta">{harness.readiness.replaceAll("_", " ")}</span>
                  </div>
                  <button
                    className="send"
                    disabled={!projectId || busy}
                    title={
                      !projectId
                        ? "Open a project first — a harness spawns into its folder."
                        : busy
                          ? "Waiting for the current request to finish."
                          : undefined
                    }
                    onClick={() => void spawnHarness(harness.id)}
                  >
                    Spawn
                  </button>
                </div>
              ))}
            </div>

            {harnessSessions.length > 0 && (
              <div className="inspector-block">
                <h4>Active Sessions</h4>
                {harnessSessions.map((item) => (
                  <div className="change-row" key={item.id}>
                    <button
                      className={`list-item${item.id === session?.id ? " active" : ""}`}
                      onClick={() => {
                        setSessionId(item.id);
                        setView("chat");
                      }}
                    >
                      <span className="truncate">{item.title}</span>
                      <span className="meta">{item.harnessState}</span>
                    </button>
                    <button className="ghost" onClick={() => void cancelHarness(item.id)}>
                      Cancel
                    </button>
                    <button className="danger" onClick={() => void closeHarness(item.id)}>
                      Close
                    </button>
                  </div>
                ))}
              </div>
            )}

            {activeRun && (
              <div className="inspector-block">
                <h4>Run Activity</h4>
                {steps.map((step) => (
                  <div className={`step ${step.status}`} key={step.id}>
                    {/* Error first: the fallback arm rendered a failed step as
                        a pending circle, so a failure read as "not started". */}
                    <span className="glyph">
                      {step.status === "error"
                        ? "✕"
                        : step.status === "complete"
                          ? "✓"
                          : step.status === "active"
                            ? "●"
                            : "○"}
                    </span>
                    <span className="truncate">{step.label}</span>
                    {step.detail && step.status === "error" && (
                      <span className="step-detail">{step.detail}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
