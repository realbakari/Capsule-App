import { useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import type {
  FileEntry,
  FilePreview,
  GitPullRequest,
  GitPullRequestDetail,
  LocalServer,
} from "@capsule/shared";
import { folderBasename, projectFolderList } from "@capsule/shared";
import { useRememberedScroll } from "../../lib/remembered-scroll";
import { FileSaveCoordinator, isConflictError } from "../../lib/file-save";
import { fileDrafts, fileOwnerKey } from "../../lib/file-drafts";
import { RecoverableFiles } from "./RecoverableFiles";
import { RequestScope } from "../../lib/request-scope";
import { useScopedState } from "../../lib/scoped-state";
import { DirectoryListings } from "../../lib/directory-listings";
import { formatUserError } from "../../lib/errors";
import { clampPanelWidth, fitPanelWidth } from "../../lib/panel-size";
import { formatProjectRoot, toWorkspaceRelative } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { DiffView } from "./DiffView";
import { EmbeddedBrowser } from "./EmbeddedBrowser";
import { FilePreviewView } from "./FilePreview";
import { FileTreePane, sortTreeEntries } from "./FileTree";
import { ThreadAgents } from "./ThreadAgents";
import { GitPullRequestDetail as PullRequestDetailView } from "./PullRequestDetail";
import { PullRequestList } from "./PullRequestList";
import { ReviewCommitForm } from "./ReviewCommitForm";
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

type InspectorTool = "launcher" | "review" | "terminal" | "browser" | "files" | "chat" | "agents";

function toolFromTab(tab: string): InspectorTool {
  if (tab === "term") return "terminal";
  if (tab === "changes" || tab === "diff") return "review";
  if (tab === "agents" || tab === "run") return "agents";
  if (tab === "chat") return "chat";
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
  if (tool === "agents") return "Agents";
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
  { tool: "agents", label: "Agents", detail: "This thread’s agent and reported delegated tasks.", icon: CpuIcon, blockedBy: () => undefined },
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
  agents: "",
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
    setNotice,
    setView,
    toggleInspector,
    setInspectorOpen,
    inspectorOpen,
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
  /*
   * The inspector shows one tool at a time, so leaving a pane unmounts it.
   * Scoped by thread: a Review position belongs to the pull request being
   * read, and restoring it into a different thread is worse than the top.
   */
  const reviewScroll = useRememberedScroll<HTMLDivElement>(`review:${session?.id ?? ""}`);
  const chatScroll = useRememberedScroll<HTMLDivElement>(`agents:${session?.id ?? ""}`);
  const [isMaximized, setIsMaximized] = useState(false);
  /*
   * Maximising changes the panel's width by a lot, and the width transition
   * turned that into the chat column being squeezed for the length of the
   * animation. A drag already opts out; so does this, for the two frames the
   * new width needs to land.
   */
  const [sizing, setSizing] = useState(false);
  useLayoutEffect(() => {
    setSizing(true);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSizing(false));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [isMaximized]);
  const [resizing, setResizing] = useState(false);
  const [showTree, setShowTree] = useState(true);

  const [activeTool, setActiveTool] = useState<InspectorTool>(() => toolFromTab(inspectorTab));
  const [openTabs, setOpenTabs] = useState<OpenTabItem[]>(() => {
    const tool = toolFromTab(inspectorTab);
    return tool === "launcher" ? [] : [{ id: tool, title: toolTitle(tool) }];
  });

  const [fileRoot, setFileRoot] = useState<string>();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [fileSearch, setFileSearch] = useState("");
  const [searchHits, setSearchHits] = useState<FileEntry[] | null>(null);
  const [preview, setPreview] = useState("");
  const [previewDoc, setPreviewDoc] = useState<FilePreview>();
  const [previewEditing, setPreviewEditing] = useState(false);
  const [editing, setEditing] = useState<{ projectId: string; root: string; path: string; truncated: boolean; revision: string }>();
  const [saveState, setSaveState] = useState<
    "idle" | "pending" | "saving" | "saved" | "error" | "truncated" | "conflict"
  >("idle");
  const saverRef = useRef<FileSaveCoordinator | undefined>(undefined);
  const revisionRef = useRef<{ value?: string }>({});
  const fileRequest = useRef(0);
  const fileScope = useRef("");

  const [localServers, setLocalServers] = useState<LocalServer[]>([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [serversError, setServersError] = useState<string>();
  const [serversRefresh, setServersRefresh] = useState(0);
  // `undefined` means the lookup did not answer; an empty array means none.
  const [pullRequests, setPullRequests] = useState<GitPullRequest[] | undefined>();
  const [listRefreshVersion, setListRefreshVersion] = useState(0);
  const forceNextListRead = useRef(false);
  const [pullRequestsLoading, setPullRequestsLoading] = useState(false);
  const [pullRequestsError, setPullRequestsError] = useState<string>();
  const [selectedPullRequest, setSelectedPullRequest] = useState<GitPullRequest>();
  const [pullRequestDetail, setPullRequestDetail] = useState<GitPullRequestDetail>();
  const [pullRequestDetailLoading, setPullRequestDetailLoading] = useState(false);
  const [pullRequestDetailError, setPullRequestDetailError] = useState<string>();
  const pullRequestRequest = useRef(0);

  const [termCmd, setTermCmd] = useState("");
  const [termOut, setTermOut] = useState("");
  const [termBusy, setTermBusy] = useState(false);


  const harnesses = harnessList ?? [];
  const dedicated = harnesses.find((item) => item.id === project?.defaultAgentId);

  const folderRoots = useMemo(() => {
    const projectRoots = projectFolderList(project ?? {});
    return session?.workingDirectory && session.workingDirectory !== project?.workingDirectory
      ? [session.workingDirectory, ...projectRoots.filter((root) => root !== project?.workingDirectory)]
      : projectRoots;
  }, [project, session?.workingDirectory]);
  const activeRoot =
    (fileRoot && folderRoots.find((root) => root.toLowerCase() === fileRoot.toLowerCase())) ||
    (session?.workingDirectory ?? project?.workingDirectory);
  const conversationRoot = session?.workingDirectory ?? project?.workingDirectory;
  const scope = JSON.stringify([projectId, session?.id, activeRoot]);
  const diffRequests = useRef(new RequestScope()).current;
  const diffScope = diffRequests.select(JSON.stringify([scope, git?.branch]));
  const [diff, setDiff] = useScopedState(diffScope, "");
  const directoryCache = useMemo(() => new DirectoryListings(async (path) => {
    if (!projectId || !activeRoot) return [];
    return sortTreeEntries(await api.listFiles(projectId, path || undefined, activeRoot));
  }), [api, projectId, activeRoot, scope]);
  const directoryStates = useSyncExternalStore(directoryCache.subscribe, directoryCache.getSnapshot);
  const refreshDirectory = useCallback((path: string) => { void directoryCache.load(path, true); }, [directoryCache]);
  const listing = directoryStates[""]?.entries ?? files;
  const childrenByDir = useMemo(() => Object.fromEntries(Object.entries(directoryStates)
    .filter((entry): entry is [string, typeof entry[1] & { entries: FileEntry[] }] => Boolean(entry[1].entries))
    .map(([path, value]) => [path, value.entries])), [directoryStates]);
  const visibleDirectories = useRef(expanded);
  visibleDirectories.current = expanded;
  if (fileScope.current !== scope) {
    fileScope.current = scope;
    fileRequest.current += 1;
  }

  useEffect(() => {
    const previous = saverRef.current;
    previous?.dispose();
    if (!editing) {
      saverRef.current = undefined;
      return;
    }
    const owner = editing;
    const revision = { value: editing.revision as string | undefined };
    revisionRef.current = revision;
    let mounted = true;
    const saver = new FileSaveCoordinator({
      debounceMs: 600,
      persist: async (contents) => {
        if (mounted) setSaveState("saving");
        const written = await api.writeFile(owner.projectId, owner.path, contents, {
          origin: "user",
          expectedRevision: revision.value,
          root: owner.root,
        });
        revision.value = written?.revision;
      },
      onSaved: (contents) => {
        fileDrafts.saved(owner, contents, revision.value);
        if (mounted) setSaveState("saved");
      },
      onError: (error) => {
        const conflict = isConflictError(error);
        fileDrafts.failed(owner, conflict);
        if (mounted) setSaveState(conflict ? "conflict" : "error");
      },
    });
    saverRef.current = saver;
    const recovered = fileDrafts.get(owner);
    if (recovered) {
      saver.change(recovered.contents);
      if (recovered.state !== "pending") saver.pause();
    }
    return () => { mounted = false; saver.dispose(); };
  }, [api, editing]);

  /*
   * Only when the conversation moves. This used to depend on `files`, which
   * changes on every workspace refresh — and a refresh happens on every
   * message an agent streams — so browsing a second project folder lasted
   * until the next frame arrived and snapped the tree back to the root.
   */
  useLayoutEffect(() => {
    setFileRoot(session?.workingDirectory ?? project?.workingDirectory);
  }, [project?.workingDirectory, projectId, session?.workingDirectory]);

  useEffect(() => {
    setExpanded(new Set());
  }, [projectId, project?.workingDirectory, session?.workingDirectory]);

  useEffect(() => {
    if (activeTool !== "browser") return undefined;
    let disposed = false;
    let running = false;
    const refreshServers = () => {
      if (running) return;
      running = true;
      setServersLoading(true);
      void api
        .listLocalServers()
        .then((servers) => {
          if (!disposed) { setLocalServers(servers as LocalServer[]); setServersError(undefined); }
        })
        .catch((error) => { if (!disposed) setServersError(formatUserError(error)); })
        .finally(() => {
          running = false;
          if (!disposed) setServersLoading(false);
        });
    };
    refreshServers();
    const timer = window.setInterval(refreshServers, 5_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeTool, api, serversRefresh]);

  useEffect(() => {
    if (activeTool !== "review" || !projectId || !git?.isRepo) {
      setPullRequests([]);
      setSelectedPullRequest(undefined);
      setPullRequestDetail(undefined);
      return;
    }
    let disposed = false;
    const force = forceNextListRead.current;
    forceNextListRead.current = false;
    setPullRequestsLoading(true);
    void api
      .listPullRequests(projectId, session?.id, force)
      .then((result) => {
        if (disposed) return;
        const answer = result as { items?: GitPullRequest[]; error?: string } | undefined;
        setPullRequests(answer?.items);
        setPullRequestsError(answer?.error);
      })
      .catch((error: unknown) => {
        if (!disposed) setPullRequestsError(formatUserError(error));
      })
      .finally(() => {
        if (!disposed) setPullRequestsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [activeTool, api, git?.branch, git?.isRepo, projectId, session?.id, listRefreshVersion]);

  useEffect(() => {
    pullRequestRequest.current += 1;
    setSelectedPullRequest(undefined);
    setPullRequestDetail(undefined);
    setPullRequestDetailLoading(false);
    setPullRequestDetailError(undefined);
    setPullRequests(undefined);
    setPullRequestsError(undefined);
  }, [projectId, session?.id]);

  function openPullRequest(pullRequest: GitPullRequest, refresh = false) {
    if (!projectId) return;
    const request = ++pullRequestRequest.current;
    setSelectedPullRequest(pullRequest);
    if (!refresh) setPullRequestDetail(undefined);
    setPullRequestDetailError(undefined);
    setPullRequestDetailLoading(true);
    void api
      .getPullRequest(projectId, pullRequest.number, session?.id)
      .then((value) => {
        if (pullRequestRequest.current === request) {
          if (value) setPullRequestDetail(value as GitPullRequestDetail);
          else setPullRequestDetailError("GitHub did not return details for this pull request.");
        }
      })
      .catch((error: unknown) => {
        if (pullRequestRequest.current === request) setPullRequestDetailError(formatUserError(error));
      })
      .finally(() => {
        if (pullRequestRequest.current === request) setPullRequestDetailLoading(false);
      });
  }

  useLayoutEffect(() => {
    setPreviewDoc(undefined);
    setPreviewEditing(false);
    setEditing(undefined);
    setPreview("");
    setSaveState("idle");
    setExpanded(new Set());
  }, [scope]);

  useEffect(() => {
    if (activeTool !== "files" || inspectorOpen === false) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refreshVisible = async () => {
      if (!document.hidden) await directoryCache.refresh(["", ...visibleDirectories.current]);
      if (!disposed) timer = setTimeout(() => void refreshVisible(), 5000);
    };
    void refreshVisible();
    return () => { disposed = true; clearTimeout(timer); };
  }, [directoryCache, activeTool, inspectorOpen, files]);

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
    if (tool !== "review") diffRequests.capture("diff");
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
    else if (tool === "chat") setInspectorTab("chat");
    else if (tool === "agents") setInspectorTab("agents");
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
    // The request is the trigger; folder ownership is checked inside previewFile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedFile, projectId, activeRoot]);

  const clearFileSearch = useCallback(() => setFileSearch(""), []);
  const openRoot = useCallback((root: string) => {
    setFileRoot(root);
    setExpanded(new Set());
    void directoryCache.refresh([""]);
  }, [directoryCache]);

  const toggleFolder = useCallback((path: string) => {
    const closing = expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (closing) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!closing) void directoryCache.load(path, true);
  }, [expanded, directoryCache]);

  const previewFile = useCallback(async (relative: string) => {
    if (!projectId || !activeRoot) return;
    diffRequests.capture("diff");
    const request = ++fileRequest.current;
    const requestedScope = fileScope.current;
    const current = () => request === fileRequest.current && requestedScope === fileScope.current;
    try {
      const doc = await api.previewFile(projectId, relative, activeRoot);
      if (!current()) return;
      const recovered = fileDrafts.get({ projectId, root: activeRoot, path: relative });
      setPreviewDoc(doc);
      setPreview(recovered?.contents ?? doc.contents ?? "");
      setPreviewEditing(Boolean(recovered));
      setEditing(
        doc.kind === "text" && !doc.truncated && Boolean(doc.revision)
          ? {
              projectId,
              root: activeRoot,
              path: relative,
              truncated: false,
              revision: recovered?.revision ?? doc.revision ?? "",
            }
          : undefined,
      );
      setSaveState(recovered?.state ?? (doc.truncated ? "truncated" : "idle"));
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
      if (!current()) return;
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
  }, [api, projectId, activeRoot, setInspectorOpen]);

  async function showFileDiff(relative: string) {
    if (!projectId) return;
    const current = diffRequests.capture("diff");
    setDiff("Loading diff…");
    try {
      const text = await api.gitDiff(projectId, relative, session?.id);
      if (!current()) return;
      setDiff(text || "(no differences)");
    } catch {
      if (!current()) return;
      setDiff("Failed to load diff.");
    }
    setPreviewDoc(undefined);
    setEditing(undefined);
    selectTool("review");
    setInspectorOpen(true);
  }

  const renderToolIcon = (tool: InspectorTool) => {
    switch (tool) {
      case "agents":
        return <CpuIcon size={14} />;
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
      data-resizing={resizing || sizing ? "true" : undefined}
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
              <span className="mono" title={git?.branch}>{git?.branch ?? "No branch"}</span>
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
          ) : activeTool === "agents" ? (
            <span>Current thread · reported activity</span>
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
                    if (!editing || !fileDrafts.change(editing, value, revisionRef.current.value)) {
                      setNotice("Unsaved file recovery is full. Save or discard another draft before continuing.");
                      return;
                    }
                    setPreview(value);
                    setSaveState("pending");
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
                  onReload={() => {
                    saverRef.current?.discard();
                    if (editing) fileDrafts.discard(editing);
                    void previewFile(previewDoc.path);
                  }}
                  onRetry={() => void saverRef.current?.flush()}
                  onCopy={() => void navigator.clipboard.writeText(preview).catch((error) => setNotice(formatUserError(error)))}
                  onOverwrite={() => {
                    revisionRef.current.value = undefined;
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

            <RecoverableFiles onError={setNotice} onDiscard={(owner) => {
              fileDrafts.discard(owner);
              if (editing && fileOwnerKey(editing) === fileOwnerKey(owner)) {
                saverRef.current?.discard();
                setEditing(undefined);
                setPreviewEditing(false);
                setSaveState("idle");
                void previewFile(owner.path);
              }
            }} />
            {showTree ? (
              <FileTreePane
                listing={listing}
                expanded={expanded}
                childrenByDir={childrenByDir}
                directoryStates={directoryStates}
                onRefreshDirectory={refreshDirectory}
                searchHits={searchHits}
                fileSearch={fileSearch}
                overlay={panelWidth < 480}
                folderRoots={folderRoots}
                activeRoot={activeRoot}
                previewPath={previewDoc?.path}
                gitFiles={git?.files}
                onFileSearchChange={setFileSearch}
                onClearSearch={clearFileSearch}
                onOpenRoot={openRoot}
                onToggleFolder={toggleFolder}
                onPreviewFile={previewFile}
              />
            ) : null}
          </div>
        )}

        {activeTool === "review" && (
          <div className="codex-tool-pane" ref={reviewScroll}>
            {selectedPullRequest ? (
              <PullRequestDetailView
                key={selectedPullRequest.number}
                summary={selectedPullRequest}
                detail={pullRequestDetail}
                loading={pullRequestDetailLoading}
                error={pullRequestDetailError}
                onRefresh={() => openPullRequest(selectedPullRequest, true)}
                onLoadCommitDiff={async (oid) => {
                  if (!projectId) throw new Error("Select a project first.");
                  return await api.getCommitDiff(projectId, oid, session?.id) as string;
                }}
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
                onOpenUrl={(url) => {
                  setBrowserUrl(url);
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

            <PullRequestList
              key={`${projectId}/${session?.id ?? ""}`}
              items={pullRequests}
              loading={pullRequestsLoading}
              error={pullRequestsError}
              onSelect={openPullRequest}
              onRefresh={() => {
                forceNextListRead.current = true;
                setListRefreshVersion((value) => value + 1);
              }}
            />

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

            {git?.isRepo && <ReviewCommitForm key={`${projectId}/${session?.id ?? ""}/${session?.workingDirectory ?? project?.workingDirectory ?? ""}`}
              dirty={Boolean(git.dirty)} onCommit={gitCommit} />}

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
            key={`${session?.id ?? projectId ?? "inbox"}:${session?.harnessId ?? ""}:${session?.openclawSessionKey ?? ""}`}
            address={browserUrl}
            onAddressChange={setBrowserUrl}
            localServers={localServers}
            serversLoading={serversLoading}
            serversError={serversError}
            onRetryServers={() => setServersRefresh((value) => value + 1)}
            onOpenExternal={(url) => void openPath(url)}
          />
        )}

        {activeTool === "agents" && <div className="codex-tool-pane"><ThreadAgents /></div>}

        {activeTool === "chat" && (
          <div className="codex-tool-pane" ref={chatScroll}>
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
