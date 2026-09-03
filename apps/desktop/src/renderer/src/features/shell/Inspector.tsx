import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  FileEntry,
  FilePreview,
  GitPullRequest,
  GitPullRequestDetail,
  LocalServer,
} from "@capsule/shared";
import { folderBasename, projectFolderList } from "@capsule/shared";
import { FileSaveCoordinator, isConflictError } from "../../lib/file-save";
import { sameListing } from "../../lib/file-listing";
import { clampPanelWidth, fitPanelWidth } from "../../lib/panel-size";
import { formatProjectRoot, toWorkspaceRelative } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { DiffView } from "./DiffView";
import { EmbeddedBrowser } from "./EmbeddedBrowser";
import { FilePreviewView } from "./FilePreview";
import { FileTreePane, sortTreeEntries } from "./FileTree";
import { GitPullRequestDetail as PullRequestDetailView } from "./PullRequestDetail";
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
export const INSPECTOR_REVISION = 3;

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

/**
 * The surfaces this panel can show, with what each one opens and the condition
 * that stops it. `blockedBy` returns the reason rather than a boolean, so the
 * card can say it — a greyed control that does not explain itself just looks
 * broken.
 */
export const SURFACES: Array<{
  tool: InspectorTool;
  label: string;
  detail: string;
  icon: typeof DiffIcon;
  blockedBy: (state: {
    projectId?: string;
    git?: { isRepo?: boolean; dirty?: boolean };
  }) => string | undefined;
}> = [
  {
    tool: "review",
    label: "Review",
    detail: "Changed files and their diff.",
    icon: DiffIcon,
    blockedBy: ({ git }) => (git?.isRepo ? undefined : "Available for Git repositories."),
  },
  {
    tool: "terminal",
    label: "Terminal",
    detail: "Run a command in the project folder.",
    icon: TerminalIcon,
    blockedBy: ({ projectId }) => (projectId ? undefined : "Open a project first."),
  },
  {
    tool: "files",
    label: "Files",
    detail: "Browse and edit workspace files.",
    icon: FolderIcon,
    blockedBy: ({ projectId }) => (projectId ? undefined : "Open a project first."),
  },
  {
    tool: "browser",
    label: "Browser",
    detail: "Open a local app or URL.",
    icon: GlobeIcon,
    blockedBy: () => undefined,
  },
  {
    tool: "chat",
    label: "Side chat",
    detail: "Ask without interrupting the thread.",
    icon: MessageSquarePlusIcon,
    blockedBy: () => undefined,
  },
];

const TOOL_SHORTCUTS: Record<InspectorTool, string> = {
  launcher: "",
  review: "⌃⇧G",
  terminal: "⌃`",
  browser: "",
  files: "",
  chat: "⌥⌘S",
};

/* The panel's own bounds, and what the conversation keeps beside it. */
const PANEL_MIN_WIDTH = 340;
const PANEL_MAX_WIDTH = 1080;
const CONVERSATION_MIN_WIDTH = 480;

/** The width the panel and the conversation share. */
function available(): number {
  return document.querySelector(".workspace-body")?.clientWidth ?? window.innerWidth;
}

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
    setDraft,
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
    browserUrl,
    setBrowserUrl,
    requestedFile,
    clearRequestedFile,
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
  const [resizing, setResizing] = useState(false);
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

  const [localServers, setLocalServers] = useState<LocalServer[]>([]);
  const [serversLoading, setServersLoading] = useState(false);
  // `undefined` means the lookup did not answer; an empty array means none.
  const [pullRequests, setPullRequests] = useState<GitPullRequest[] | undefined>([]);
  const [pullRequestsLoading, setPullRequestsLoading] = useState(false);
  const [pullRequestsError, setPullRequestsError] = useState<string>();
  const [selectedPullRequest, setSelectedPullRequest] = useState<GitPullRequest>();
  const [pullRequestDetail, setPullRequestDetail] = useState<GitPullRequestDetail>();
  const [pullRequestDetailLoading, setPullRequestDetailLoading] = useState(false);
  const pullRequestRequest = useRef(0);

  const [termCmd, setTermCmd] = useState("");
  const [termOut, setTermOut] = useState("");
  const [termBusy, setTermBusy] = useState(false);

  const [message, setMessage] = useState("");

  const harnesses = harnessList ?? [];
  const dedicated = harnesses.find((item) => item.id === project?.defaultAgentId);

  const projectRoots = projectFolderList(project ?? {});
  const folderRoots =
    session?.workingDirectory && session.workingDirectory !== project?.workingDirectory
      ? [session.workingDirectory, ...projectRoots.filter((root) => root !== project?.workingDirectory)]
      : projectRoots;
  const activeRoot =
    (fileRoot && folderRoots.find((root) => root.toLowerCase() === fileRoot.toLowerCase())) ||
    (session?.workingDirectory ?? project?.workingDirectory);
  const conversationRoot = session?.workingDirectory ?? project?.workingDirectory;

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

  /*
   * Only when the conversation moves. This used to depend on `files`, which
   * changes on every workspace refresh — and a refresh happens on every
   * message an agent streams — so browsing a second project folder lasted
   * until the next frame arrived and snapped the tree back to the root.
   */
  useEffect(() => {
    setFileRoot(session?.workingDirectory ?? project?.workingDirectory);
  }, [project?.workingDirectory, projectId, session?.workingDirectory]);

  useEffect(() => {
    setExpanded(new Set());
    setChildrenByDir({});
  }, [projectId, project?.workingDirectory, session?.workingDirectory]);

  useEffect(() => {
    if (activeTool !== "browser") return undefined;
    let disposed = false;
    const refreshServers = () => {
      setServersLoading(true);
      void api
        .listLocalServers()
        .then((servers) => {
          if (!disposed) setLocalServers(servers as LocalServer[]);
        })
        .finally(() => {
          if (!disposed) setServersLoading(false);
        });
    };
    refreshServers();
    const timer = window.setInterval(refreshServers, 5_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeTool, api]);

  useEffect(() => {
    if (activeTool !== "review" || !projectId || !git?.isRepo) {
      setPullRequests([]);
      setSelectedPullRequest(undefined);
      setPullRequestDetail(undefined);
      return;
    }
    let disposed = false;
    setPullRequestsLoading(true);
    void api
      .listPullRequests(projectId, session?.id)
      .then((result) => {
        if (disposed) return;
        const answer = result as { items?: GitPullRequest[]; error?: string } | undefined;
        setPullRequests(answer?.items);
        setPullRequestsError(answer?.error);
      })
      .finally(() => {
        if (!disposed) setPullRequestsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [activeTool, api, git?.branch, git?.isRepo, projectId, session?.id]);

  useEffect(() => {
    pullRequestRequest.current += 1;
    setSelectedPullRequest(undefined);
    setPullRequestDetail(undefined);
    setPullRequestDetailLoading(false);
  }, [projectId, session?.id]);

  function openPullRequest(pullRequest: GitPullRequest) {
    if (!projectId) return;
    const request = ++pullRequestRequest.current;
    setSelectedPullRequest(pullRequest);
    setPullRequestDetail(undefined);
    setPullRequestDetailLoading(true);
    void api
      .getPullRequest(projectId, pullRequest.number, session?.id)
      .then((value) => {
        if (pullRequestRequest.current === request) {
          setPullRequestDetail(value as GitPullRequestDetail | undefined);
        }
      })
      .catch(() => {
        if (pullRequestRequest.current === request) setPullRequestDetail(undefined);
      })
      .finally(() => {
        if (pullRequestRequest.current === request) setPullRequestDetailLoading(false);
      });
  }

  useEffect(() => {
    setPreviewDoc(undefined);
    setPreviewEditing(false);
    setEditing(undefined);
    setPreview("");
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !activeRoot) {
      setListing((current) => (sameListing(current, files) ? current : files));
      return;
    }
    let ignore = false;
    api
      .listFiles(projectId, undefined, activeRoot)
      // An unchanged listing keeps the array it already had: replacing it with
      // an equal copy rebuilds the tree and flashes the rows on every frame.
      .then((entries) => {
        if (!ignore) setListing((current) => (sameListing(current, entries) ? current : entries));
      })
      .catch(() => {
        if (!ignore) setListing((current) => (current.length === 0 ? current : []));
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
    setResizing(true);
    const move = (next: PointerEvent) => {
      setPanelWidth((current) => {
        const nextWidth = clampPanelWidth({
          requested: start + (origin - next.clientX),
          current,
          available: available(),
          min: PANEL_MIN_WIDTH,
          max: PANEL_MAX_WIDTH,
          minContent: CONVERSATION_MIN_WIDTH,
        });
        try {
          localStorage.setItem("capsule.inspectorWidth", String(nextWidth));
        } catch {
          // ignore
        }
        return nextWidth;
      });
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /*
   * A width saved on a wide screen must not crush the conversation when the
   * window gets smaller — or when the app opens on a laptop display.
   */
  useEffect(() => {
    const refit = () => {
      setPanelWidth((current) =>
        fitPanelWidth({
          current,
          available: available(),
          min: PANEL_MIN_WIDTH,
          minContent: CONVERSATION_MIN_WIDTH,
        }),
      );
    };
    refit();
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, []);

  /*
   * A path clicked in the transcript. It used to open the file tree and stop
   * there, which is the folder the file is in rather than the file — so the
   * one thing the click was about still had to be found by hand.
   */
  useEffect(() => {
    if (!requestedFile || !projectId) return;
    const relative = toWorkspaceRelative(requestedFile, activeRoot);
    clearRequestedFile();
    setActiveTool("files");
    void previewFile(relative);
    // previewFile is redefined on every render; the request is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedFile, projectId, activeRoot]);

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
      const text = await api.gitDiff(projectId, relative, session?.id);
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
      data-resizing={resizing ? "true" : undefined}
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
                {conversationRoot
                  ? formatProjectRoot(conversationRoot, { home: window.capsule.homeDir })
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
            {/*
              * A chooser, not a bare grid of buttons. Each surface says what it
              * opens, and one that cannot open says why instead of being a
              * button that does nothing when clicked — a disabled control with
              * no reason is a dead end.
              */}
            <div className="codex-launcher-head">
              <h3>Open a surface</h3>
              <p>Choose what to show in this panel.</p>
            </div>
            <div className="codex-launcher-cards">
              {SURFACES.map((surface) => {
                const Icon = surface.icon;
                const blocked = surface.blockedBy({ projectId, git });
                return (
                  <button
                    key={surface.tool}
                    type="button"
                    className="codex-launcher-card squish-click"
                    disabled={Boolean(blocked)}
                    title={blocked ?? `Open ${surface.label}`}
                    onClick={() => selectTool(surface.tool)}
                  >
                    <span className="codex-launcher-lead">
                      <span className="codex-launcher-icon">
                        <Icon size={16} />
                      </span>
                      <span className="codex-launcher-label">{surface.label}</span>
                      {TOOL_SHORTCUTS[surface.tool] ? (
                        <kbd className="codex-launcher-kbd">{TOOL_SHORTCUTS[surface.tool]}</kbd>
                      ) : null}
                    </span>
                    <span className="codex-launcher-detail">{blocked ?? surface.detail}</span>
                  </button>
                );
              })}
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
                      activeRoot && activeRoot !== conversationRoot
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
            {selectedPullRequest ? (
              <PullRequestDetailView
                key={selectedPullRequest.number}
                summary={selectedPullRequest}
                detail={pullRequestDetail}
                loading={pullRequestDetailLoading}
                onBack={() => {
                  pullRequestRequest.current += 1;
                  setSelectedPullRequest(undefined);
                  setPullRequestDetail(undefined);
                  setPullRequestDetailLoading(false);
                }}
                onOpenBrowser={() => {
                  setBrowserUrl(selectedPullRequest.url);
                  selectTool("browser");
                }}
                onSteerAgent={(prompt) => {
                  setDraft(prompt);
                  setView("chat");
                }}
              />
            ) : (
              <>
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

            <div className="codex-pr-list">
              <div className="codex-pr-list-head">
                {/* No count until there is one: "(0)" beside "could not be
                    reached" claimed to know a number we had not been told. */}
                <h4>Open pull requests{pullRequests ? ` (${pullRequests.length})` : ""}</h4>
                {pullRequestsLoading ? <span className="faint">Refreshing…</span> : null}
              </div>
              {!pullRequestsLoading && !pullRequests ? (
                <p className="faint">
                  {pullRequestsError ??
                    "GitHub could not be reached. Check that `gh` is signed in, then refresh."}
                </p>
              ) : null}
              {!pullRequestsLoading && pullRequests?.length === 0 ? (
                <p className="faint">No open pull requests were found for this repository.</p>
              ) : null}
              {(pullRequests ?? []).map((pullRequest) => (
                <button
                  type="button"
                  className="codex-pr-row"
                  key={pullRequest.number}
                  onClick={() => openPullRequest(pullRequest)}
                >
                  <span className="codex-pr-number">#{pullRequest.number}</span>
                  <span className="codex-pr-copy">
                    <b>{pullRequest.title}</b>
                    <small>
                      {[pullRequest.author, pullRequest.headRefName].filter(Boolean).join(" · ") || "Open pull request"}
                    </small>
                  </span>
                  <span className={`codex-pr-checks ${pullRequest.checks ?? "none"}`}>
                    {pullRequest.isDraft ? "Draft" : pullRequest.checks ?? "Open"}
                  </span>
                </button>
              ))}
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
              </>
            )}
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
          <EmbeddedBrowser
            address={browserUrl}
            onAddressChange={setBrowserUrl}
            localServers={localServers}
            serversLoading={serversLoading}
            onOpenExternal={(url) => void openPath(url)}
          />
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
