import { useCallback, useMemo, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { usePanelResize } from "../../lib/panel-resize";
import type {
  FileEntry,
  FilePreview,
  GitPullRequest,
  GitPullRequestDetail,
  GitPullRequestStackAction,
  LocalServer,
} from "@capsule/shared";
import { mergePrompt, rebasePrompt } from "../../lib/pull-request-stack";
import { folderBasename, conversationFolderRoots, type HarnessReadiness } from "@capsule/shared";
import { useRememberedScroll } from "../../lib/remembered-scroll";
import { FileSaveCoordinator, isConflictError } from "../../lib/file-save";
import { fileDrafts, fileOwnerKey } from "../../lib/file-drafts";
import { RecoverableFiles } from "./RecoverableFiles";
import { DirectoryListings } from "../../lib/directory-listings";
import { formatUserError } from "../../lib/errors";
import { clampPanelWidth, fitPanelWidth, restorePanelWidth } from "../../lib/panel-size";
import { formatProjectRoot, toWorkspaceRelative } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { DiffView } from "./DiffView";
import { ReviewDiff } from "../review/ReviewDiff";
import { EmbeddedBrowser } from "./EmbeddedBrowser";
import { SimulatorPane } from "./SimulatorPane";
import { FilePreviewView } from "./FilePreview";
import { OpenInControl } from "../open-in/OpenInPicker";
import { FileTreePane, sortTreeEntries } from "./FileTree";
import { ThreadAgents } from "./ThreadAgents";
import { ComparePane } from "../best-of-n/ComparePane";
import { SURFACES, tabForTool, toolFromTab, type InspectorTool } from "./surfaces";
import { InspectorHeadSlot } from "./inspector-slot";
import { useFollowAgent } from "./use-follow-agent";
import "./follow-agent.css";
import { GitPullRequestDetail as PullRequestDetailView } from "./PullRequestDetail";
import { PullRequestList } from "./PullRequestList";
import { PullRequestCheckoutDialog } from "../worktree-base/PullRequestCheckoutDialog";
import { ReviewCommitForm } from "./ReviewCommitForm";
import { RequestScope } from "../../lib/request-scope";
import { useScopedState } from "../../lib/scoped-state";
import { ReviewScopeBar, useReviewTurns } from "../review/ReviewScopeBar";
import {
  chooseReview,
  ignoreWhitespaceFor,
  rememberIgnoreWhitespace,
  reviewSelection,
  useReviewChoices,
  useReviewScope,
} from "../../lib/review-scope";
import {
  ColumnsIcon,
  CpuIcon,
  DiffIcon,
  FileIcon,
  MaximizeIcon,
  MinimizeIcon,
  MousePointerClickIcon,
  PlusIcon,
  UndoIcon,
  CloudUploadIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  XIcon,
} from "./icons";

/** Bump when the inspector shell changes so a stuck error panel remounts. */
export const INSPECTOR_REVISION = 3;

export { SURFACES } from "./surfaces";

/* The panel's own bounds, and what the conversation keeps beside it. */
const PANEL_MIN_WIDTH = 340;
const PANEL_MAX_WIDTH = 1080;
const CONVERSATION_MIN_WIDTH = 480;
const FILES_SPLIT_MIN_WIDTH = 480;

/** The width the panel and the conversation share. */
/** Surfaces that put their own controls in the panel header instead of a title. */
const HEAD_SLOT_TOOLS = new Set<InspectorTool>(["simulator", "browser"]);

/** Room for the conversation and the panel together: the window less the sidebar. */
function available(): number {
  const app = document.querySelector<HTMLElement>(".app");
  // Drawn outside the app shell (a preview, a test), the panel's own container is the room.
  if (!app) return document.querySelector<HTMLElement>(".inspector")?.parentElement?.clientWidth ?? window.innerWidth;
  const sidebar = document.querySelector<HTMLElement>(".app > .sidebar");
  return app.clientWidth - (sidebar && getComputedStyle(sidebar).position !== "absolute" ? sidebar.getBoundingClientRect().width : 0);
}

const READINESS_LABEL: Record<HarnessReadiness, string> = {
  ready: "Ready",
  dedicated: "Ready",
  running: "Running",
  missing_cli: "Not installed",
  needs_login: "Needs sign-in",
  missing_acpx: "Bridge missing",
  gateway_offline: "Gateway offline",
};

const SPAWN_BLOCKED: Partial<Record<HarnessReadiness, string>> = {
  missing_cli: "Install this agent's command-line tool first.",
  needs_login: "Sign in to this agent in a terminal first.",
  missing_acpx: "The Gateway's agent bridge is not installed.",
  gateway_offline: "The Gateway is offline.",
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
    setTerminalOpen,
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
    gitMergePullRequestStack,
    gitRebasePullRequestStack,
    setConfirm,
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
    events,
    updateSettings,
  } = useWorkspace();

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      return restorePanelWidth(localStorage.getItem("capsule.inspectorWidth"), PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, 520);
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
  const { resizing, startResize } = usePanelResize(inspectorOpen && !isMaximized);
  useEffect(() => {
    // Persist committed React state, never as a side effect of a state updater.
    try { localStorage.setItem("capsule.inspectorWidth", String(panelWidth)); } catch { /* Optional preference. */ }
  }, [panelWidth]);
  const [showTree, setShowTree] = useState(true);
  const inspectorElement = useRef<HTMLElement>(null);
  const [compactFiles, setCompactFiles] = useState(false);
  useLayoutEffect(() => {
    const element = inspectorElement.current;
    if (!element) return;
    // Use the rendered width: the saved drag width is wrong when maximized
    // or constrained by a smaller window.
    const measure = () => setCompactFiles(element.clientWidth < FILES_SPLIT_MIN_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /* One surface at a time, chosen by the titlebar's icon bar; the workspace holds which. */
  const activeTool = toolFromTab(inspectorTab);
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);

  const [fileRoot, setFileRoot] = useState<string>();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [fileSearch, setFileSearch] = useState("");
  const [fileSearchResult, setFileSearchResult] = useState<{ key: string; hits: FileEntry[]; loading: boolean; error?: string }>();
  const [fileSearchRetry, setFileSearchRetry] = useState(0);
  const retryFileSearch = useCallback(() => setFileSearchRetry((value) => value + 1), []);
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
  const [stackBusy, setStackBusy] = useState(false);
  const [checkoutPullRequest, setCheckoutPullRequest] = useState<GitPullRequest>();
  // Checking a pull request out writes to the repository; a paired viewer only reads.
  const workOnPullRequest = api.isDesktop === false ? undefined : setCheckoutPullRequest;
  const reviewScope = JSON.stringify([projectId, session?.id]);
  const latestReview = useRef({ scope: reviewScope, refresh: () => {} });
  const pullRequestRequest = useRef(0);



  const harnesses = harnessList ?? [];
  const dedicated = harnesses.find((item) => item.id === project?.defaultAgentId);

  const folderRoots = useMemo(() => conversationFolderRoots(project ?? {}, session?.workingDirectory), [project, session?.workingDirectory]);
  const activeRoot =
    (fileRoot && folderRoots.find((root) => root.toLowerCase() === fileRoot.toLowerCase())) ||
    (session?.workingDirectory ?? project?.workingDirectory);
  const conversationRoot = session?.workingDirectory ?? project?.workingDirectory;
  const fileSearchKey = JSON.stringify([projectId, activeRoot, fileSearch.trim()]);
  const searchingFiles = Boolean(projectId && fileSearch.trim().length >= 2);
  const currentFileSearch = fileSearchResult?.key === fileSearchKey ? fileSearchResult : undefined;
  const searchHits = searchingFiles ? currentFileSearch?.hits ?? [] : null;
  const fileSearchLoading = searchingFiles && (currentFileSearch?.loading ?? true);
  const scope = JSON.stringify([projectId, session?.id, activeRoot]);
  const diffRequests = useRef(new RequestScope()).current;
  const reviewPathScope = diffRequests.select(JSON.stringify([scope, git?.branch]));
  const [reviewPath, setReviewPath] = useScopedState<string | undefined>(reviewPathScope, undefined);
  /* What Review compares: the project's scope, and for a turn this thread's pick, remembered for this window's life. */
  const reviewThread = session?.id ?? `project:${projectId ?? ""}`;
  const reviewKind = useReviewScope(projectId);
  useReviewChoices();
  const reviewTurnList = useReviewTurns(session?.id);
  const diffScope = reviewSelection(reviewKind, reviewThread, reviewTurnList.turns, reviewTurnList.loading);
  const diffTurn = diffScope.kind === "turn" ? reviewTurnList.turns.find((turn) => turn.runId === diffScope.runId) : undefined;
  const ignoreWhitespace = ignoreWhitespaceFor(reviewThread, settings?.diffIgnoreWhitespace ?? false);
  const directoryCache = useMemo(() => new DirectoryListings(async (path) => {
    if (!projectId || !activeRoot) return [];
    return sortTreeEntries(await api.listFiles(projectId, path || undefined, activeRoot));
  }), [api, projectId, activeRoot, scope]);
  const directoryStates = useSyncExternalStore(directoryCache.subscribe, directoryCache.getSnapshot);
  const refreshDirectory = useCallback((path: string) => { void directoryCache.load(path, true); }, [directoryCache]);
  // Only this cache knows which root owns its entries. The workspace's latest
  // listing may still belong to the previous conversation or another folder.
  const listing = directoryStates[""]?.entries ?? [];
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

  function refreshReview() {
    forceNextListRead.current = true;
    setListRefreshVersion((value) => value + 1);
    if (selectedPullRequest) openPullRequest(selectedPullRequest, true);
  }

  useLayoutEffect(() => {
    latestReview.current = { scope: reviewScope, refresh: refreshReview };
  });
  useEffect(() => { setStackBusy(false); }, [reviewScope]);

  function runStackAction(
    title: string,
    detail: string,
    confirmLabel: string,
    danger: boolean,
    operate: (action: GitPullRequestStackAction) => Promise<boolean>,
    action: GitPullRequestStackAction,
  ) {
    setConfirm({
      title,
      detail,
      confirmLabel,
      danger,
      onConfirm: () => {
        void (async () => {
          setConfirm(undefined);
          if (latestReview.current.scope !== reviewScope) return;
          setStackBusy(true);
          try {
            await operate(action);
          } finally {
            if (latestReview.current.scope === reviewScope) {
              // Refresh even after partial writes, without reselecting the PR
              // captured before the user navigated to another review.
              latestReview.current.refresh();
              setStackBusy(false);
            }
          }
        })();
      },
    });
  }

  useLayoutEffect(() => {
    setPreviewDoc(undefined);
    setShowTree(true);
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
      setFileSearchResult(undefined);
      return;
    }
    let ignore = false;
    setFileSearchResult({ key: fileSearchKey, hits: [], loading: true });
    void api
      .searchFiles(projectId, query, activeRoot)
      .then((hits) => {
        if (!ignore) setFileSearchResult({ key: fileSearchKey, hits, loading: false });
      })
      .catch((error) => {
        if (!ignore) setFileSearchResult({ key: fileSearchKey, hits: [], loading: false, error: formatUserError(error) });
      });
    return () => {
      ignore = true;
    };
  }, [activeRoot, api, fileSearch, projectId, fileSearchKey, fileSearchRetry]);

  function selectTool(tool: InspectorTool) {
    if (tool !== "files") fileRequest.current += 1;
    setInspectorTab(tabForTool(tool, Boolean(previewDoc)));
  }

  /* Leaving Files abandons any read still in flight, however the surface changed. */
  const previousTool = useRef(activeTool);
  useEffect(() => {
    if (previousTool.current === "files" && activeTool !== "files") fileRequest.current += 1;
    previousTool.current = activeTool;
  }, [activeTool]);

  useEffect(() => () => { fileRequest.current += 1; }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        Boolean(event.target.closest("input, textarea, select, [contenteditable]"));
      if (typing) return;
      if (event.ctrlKey && (event.key === "`" || event.code === "Backquote")) {
        event.preventDefault();
        setTerminalOpen(true);
      } else if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === "KeyS") {
        event.preventDefault();
        selectTool("chat");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* While the chooser shows, a surface's letter opens it, as the hint on each card says; typing in a field stays typing. */
  const launcherKeys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  launcherKeys.current = (event) => {
    if (activeTool !== "launcher" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
    const surface = SURFACES.find((item) => item.key === event.key.toLowerCase());
    if (!surface || surface.blockedBy({ projectId, git, desktop: api.isDesktop, platform: api.platform })) return;
    event.preventDefault();
    selectTool(surface.tool);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => launcherKeys.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function resizeBy(delta: number) {
    setPanelWidth((current) => clampPanelWidth({
      requested: panelWidth - delta,
      current,
      available: available(),
      min: PANEL_MIN_WIDTH,
      max: PANEL_MAX_WIDTH,
      minContent: CONVERSATION_MIN_WIDTH,
    }));
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
    if (requestedFile.projectId !== projectId || requestedFile.sessionId !== session?.id) { clearRequestedFile(); return; }
    const root = requestedFile.root ?? conversationRoot;
    if (!root || !folderRoots.includes(root)) { clearRequestedFile(); return; }
    // Select the owning folder before starting a read; a relative path alone
    // must never inherit whichever extra folder happens to be open.
    if (activeRoot !== root) { setFileRoot(root); return; }
    const relative = toWorkspaceRelative(requestedFile.path, root);
    clearRequestedFile();
    followAgent.pause();
    void previewFile(relative);
    // The request is the trigger; folder ownership is checked inside previewFile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedFile, projectId, activeRoot]);

  const clearFileSearch = useCallback(() => setFileSearch(""), []);
  const openRoot = useCallback((root: string) => {
    setFileRoot(root);
    setExpanded(new Set());
  }, []);

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
      setReviewPath(undefined);

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
    setInspectorTab("preview");
    setInspectorOpen(true);
    if (inspectorElement.current && inspectorElement.current.clientWidth < FILES_SPLIT_MIN_WIDTH) {
      setShowTree(false);
    }
  }, [api, projectId, activeRoot, setInspectorOpen]);

  /*
   * Follow agent. A path outside the open folder, or a file being edited by
   * hand, is left alone: following must never take a draft away.
   */
  const readOnlyPeer = api.isDesktop === false && api.remoteMode !== "control";
  const followAgent = useFollowAgent({
    enabled: settings?.followAgent === true,
    visible: inspectorOpen && activeTool === "files",
    run: activeRun?.sessionId === session?.id ? activeRun : undefined,
    events,
    onFollow: (path) => {
      if (!activeRoot || previewEditing) return;
      const absolute = /^(?:\/|[A-Za-z]:[\\/])/u.test(path);
      if (absolute && !path.replace(/\\/gu, "/").toLowerCase().startsWith(`${activeRoot.replace(/\\/gu, "/").toLowerCase()}/`)) return;
      const relative = toWorkspaceRelative(path, activeRoot);
      const parts = relative.split("/").slice(0, -1);
      const parents = parts.map((_, index) => parts.slice(0, index + 1).join("/"));
      if (parents.length) {
        setExpanded((current) => new Set([...current, ...parents]));
        for (const parent of parents) void directoryCache.load(parent, true);
      }
      void previewFile(relative);
    },
  });
  const setFollowAgent = (on: boolean) => {
    followAgent.resume();
    void updateSettings({ followAgent: on }).catch((error: unknown) => setNotice(formatUserError(error)));
  };
  const pauseFollow = followAgent.pause;
  const previewByHand = useCallback((path: string) => { pauseFollow(); void previewFile(path); }, [pauseFollow, previewFile]);
  const toggleFolderByHand = useCallback((path: string) => { pauseFollow(); toggleFolder(path); }, [pauseFollow, toggleFolder]);
  const openRootByHand = useCallback((root: string) => { pauseFollow(); openRoot(root); }, [pauseFollow, openRoot]);
  const searchByHand = useCallback((value: string) => { pauseFollow(); setFileSearch(value); }, [pauseFollow]);

  function showFileDiff(relative: string) {
    if (!projectId) return;
    setReviewPath(relative);
    setPreviewDoc(undefined);
    setEditing(undefined);
    selectTool("review");
    setInspectorOpen(true);
  }

  return (
    <>
    {checkoutPullRequest ? <PullRequestCheckoutDialog pullRequest={checkoutPullRequest} onClose={() => setCheckoutPullRequest(undefined)} /> : null}
    <aside
      ref={inspectorElement}
      className={`inspector panel-inspector${isMaximized ? " maximized" : ""}`}
      data-resizing={resizing || sizing ? "true" : undefined}
      style={!isMaximized ? { width: `${panelWidth}px` } : undefined}
    >
      <div className="inspector-rail" onPointerDown={(event) => startResize(event, resizeBy)} title="Drag to resize pane" />

      {/*
        * One row: what this surface is on the left, the panel's own controls on
        * the right. The titlebar's icon bar chooses the surface, so there are no
        * tabs to manage here.
        */}
      <div className="panel-tab-bar inspector-head">
        {/*
          * The simulator portals its menus into this slot. It stays mounted
          * whichever surface shows: unmounting it in the same update as the
          * simulator left React removing the menus from a detached node.
          */}
        {/* Surfaces with their own header controls draw them here, in the titlebar's row. */}
        <span className="inspector-head-slot" ref={setHeadSlot} hidden={!HEAD_SLOT_TOOLS.has(activeTool)} />
        <span className="panel-breadcrumb inspector-title truncate" hidden={HEAD_SLOT_TOOLS.has(activeTool)}>
          {activeTool === "files" ? (
            <>
              <span>Files</span>
              <span className="panel-breadcrumb-slash">/</span>
              {activeRoot ? (
                <span className="panel-breadcrumb-root">{folderBasename(activeRoot)}</span>
              ) : (
                <span>workspace</span>
              )}
              {previewDoc?.path?.includes("/") ? (
                <span className="panel-breadcrumb-dir">
                  /{previewDoc.path.split("/").slice(0, -1).join("/")}
                </span>
              ) : null}
              {previewDoc?.path ? (
                <span className="panel-breadcrumb-file">/{folderBasename(previewDoc.path)}</span>
              ) : null}
            </>
          ) : activeTool === "review" ? (
            <>
              <span>Review</span>
              <span className="panel-breadcrumb-sep">·</span>
              <span className="mono" title={git?.branch}>{git?.branch ?? "No branch"}</span>
              {diffScope.kind === "turn" && !selectedPullRequest ? (
                <span className="panel-breadcrumb-count">{diffTurn ? `Turn ${diffTurn.number}` : "Saved turn"}</span>
              ) : git?.changed ? (
                <span className="panel-breadcrumb-count">{git.changed} changed</span>
              ) : null}
            </>
          ) : activeTool === "browser" ? (
            <>
              <span>Browser</span>
              {browserUrl ? <><span className="panel-breadcrumb-sep">·</span><span className="truncate">{browserUrl}</span></> : null}
            </>
          ) : activeTool === "simulator" ? (
            null
          ) : activeTool === "agents" ? (
            <span>Agents</span>
          ) : activeTool === "compare" ? (
            <span>Compare</span>
          ) : activeTool === "chat" ? (
            <>
              <span>Side chat</span>
              {dedicated?.name ? <><span className="panel-breadcrumb-sep">·</span><span>{dedicated.name}</span></> : null}
            </>
          ) : (
            <span>Open a surface</span>
          )}
        </span>
        <div className="panel-chrome-actions">
          {activeTool === "files" && !readOnlyPeer && (
            <button
              type="button"
              className={`icon-btn${followAgent.status !== "off" ? " active" : ""}`}
              title={followAgent.status === "off" ? "Follow agent: show the file the agent is on while a turn runs" : "Stop following the agent"}
              aria-label="Follow agent"
              aria-pressed={followAgent.status !== "off"}
              onClick={() => setFollowAgent(followAgent.status === "off")}
            >
              <MousePointerClickIcon size={14} />
            </button>
          )}
          {activeTool === "files" && (
            <button
              type="button"
              className={`icon-btn${showTree ? " active" : ""}`}
              title="Toggle workspace tree"
              aria-label="Toggle workspace tree"
              aria-expanded={showTree}
              onClick={() => setShowTree((prev) => !prev)}
            >
              <ColumnsIcon size={14} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            title={isMaximized ? "Restore standard size" : "Maximize panel"}
            aria-label={isMaximized ? "Restore standard size" : "Maximize panel"}
            onClick={() => setIsMaximized((prev) => !prev)}
          >
            {isMaximized ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Close panel (⌘\)"
            aria-label="Close panel"
            onClick={toggleInspector}
          >
            <XIcon size={15} />
          </button>
        </div>
      </div>

      <div className="panel-inspector-content">
        {activeTool === "launcher" && (
          <div className="panel-launcher">
            {/*
              * A chooser, not a bare grid of buttons. Each surface says what it
              * opens, and one that cannot open says why instead of being a
              * button that does nothing when clicked — a disabled control with
              * no reason is a dead end.
              */}
            {/* The panel header already says "Open a surface"; the body starts with the choice. */}
            <p className="panel-launcher-hint">Choose what to show in this panel.</p>
            <div className="panel-launcher-cards">
              {SURFACES.map((surface) => {
                const Icon = surface.icon;
                const blocked = surface.blockedBy({ projectId, git, desktop: api.isDesktop, platform: api.platform, groupId: session?.groupId });
                return (
                  <button
                    key={surface.tool}
                    type="button"
                    className="panel-launcher-card squish-click"
                    disabled={Boolean(blocked)}
                    title={blocked ?? `Open ${surface.label}`}
                    onClick={() => selectTool(surface.tool)}
                  >
                    <span className="panel-launcher-lead">
                      <span className="panel-launcher-icon">
                        <Icon size={16} />
                      </span>
                      <span className="panel-launcher-label">{surface.label}</span>
                      <kbd className="panel-launcher-kbd" title={surface.shortcut ? `Also ${surface.shortcut} from anywhere` : undefined}>{surface.key.toUpperCase()}</kbd>
                    </span>
                    <span className="panel-launcher-detail">{blocked ?? surface.detail}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTool === "files" && (
          <div className="panel-files-surface">
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
            {(followAgent.status === "following" || followAgent.status === "paused") && (
              <div className="follow-agent-bar" role="status">
                {followAgent.status === "following" ? <>
                  <span className="follow-agent-dot" aria-hidden />
                  <span className="follow-agent-text">Following the agent{followAgent.path ? <> · <code title={followAgent.path}>{toWorkspaceRelative(followAgent.path, activeRoot)}</code></> : null}</span>
                  <button type="button" className="ghost" onClick={pauseFollow}>Pause</button>
                </> : <>
                  <span className="follow-agent-text">Paused while you browse Files.</span>
                  <button type="button" className="ghost" onClick={followAgent.resume}>Follow again</button>
                </>}
              </div>
            )}
            <div className={`panel-files-workspace${compactFiles ? " compact" : ""}${showTree && activeRoot ? " tree-visible" : ""}`}>
              <div className="panel-file-preview-pane">
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
                    openIn={projectId && activeRoot ? (
                      <OpenInControl
                        target={{ projectId, sessionId: session?.id, path: `${activeRoot.replace(/\/$/, "")}/${previewDoc.path}` }}
                        what="file"
                        variant="bar"
                      />
                    ) : undefined}
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
                  <div className="panel-empty-file-state">
                    <div className="panel-empty-file-icon" aria-hidden>
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

              {showTree && activeRoot ? (
                <FileTreePane
                  listing={listing}
                  expanded={expanded}
                  childrenByDir={childrenByDir}
                  directoryStates={directoryStates}
                  onRefreshDirectory={refreshDirectory}
                  searchHits={searchHits}
                  searchLoading={fileSearchLoading}
                  searchError={currentFileSearch?.error}
                  onRetrySearch={retryFileSearch}
                  fileSearch={fileSearch}
                  folderRoots={folderRoots}
                  activeRoot={activeRoot}
                  previewPath={previewDoc?.path}
                  gitFiles={git?.files}
                  onFileSearchChange={searchByHand}
                  onClearSearch={clearFileSearch}
                  onOpenRoot={openRootByHand}
                  onToggleFolder={toggleFolderByHand}
                  onPreviewFile={previewByHand}
                />
              ) : null}
            </div>
          </div>
        )}

        {activeTool === "review" && (
          <div className="panel-tool-pane" ref={reviewScroll}>
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
                  setDraft((current) => current.trim() ? `${current}\n\n${prompt}` : prompt);
                  setView("chat");
                }}
                stackBusy={stackBusy}
                onWork={workOnPullRequest ? () => workOnPullRequest(selectedPullRequest) : undefined}
                onSelectLayer={(number) => {
                  const listed = pullRequests?.find((item) => item.number === number);
                  if (listed) {
                    openPullRequest(listed);
                    return;
                  }
                  const url = selectedPullRequest.url.replace(/\/pull\/\d+/, `/pull/${number}`);
                  openPullRequest({
                    number,
                    url,
                    title: `Pull request #${number}`,
                    isDraft: false,
                    state: "OPEN",
                  });
                }}
                onMergeStack={(action) => {
                  const stack = pullRequestDetail?.stackDetail;
                  if (!stack) return;
                  runStackAction(
                    "Merge this stack?",
                    mergePrompt(stack, action.number),
                    "Merge stack",
                    false,
                    gitMergePullRequestStack,
                    action,
                  );
                }}
                onRebaseStack={(action) => {
                  const stack = pullRequestDetail?.stackDetail;
                  if (!stack) return;
                  runStackAction(
                    "Rebase this stack?",
                    rebasePrompt(stack),
                    "Rebase stack",
                    true,
                    gitRebasePullRequestStack,
                    action,
                  );
                }}
              />
            ) : (
              <>
            <ReviewScopeBar
              selection={diffScope}
              turns={reviewTurnList.turns}
              loadingTurns={reviewTurnList.loading}
              hasThread={Boolean(session)}
              onChoose={(value) => { if (projectId) chooseReview(projectId, reviewThread, value); }}
              ignoreWhitespace={ignoreWhitespace}
              onIgnoreWhitespace={(value) => rememberIgnoreWhitespace(reviewThread, value, settings?.diffIgnoreWhitespace ?? false)}
            />
            {diffScope.kind === "turn" ? (
              <>
                <div className="review-turn-banner" role="note">
                  <span>
                    Read-only. What {diffTurn ? `turn ${diffTurn.number}` : "this turn"} changed, from its saved checkpoint.
                  </span>
                  <button type="button" className="chip" onClick={() => { if (projectId) chooseReview(projectId, reviewThread, "uncommitted"); }}>
                    Back to uncommitted changes
                  </button>
                </div>
                {projectId ? (
                  <ReviewDiff key={`${projectId}/${session?.id ?? ""}`} projectId={projectId} sessionId={session?.id} thread={reviewThread}
                    selection={diffScope} ignoreWhitespace={ignoreWhitespace} onShowAll={() => setReviewPath(undefined)} />
                ) : null}
              </>
            ) : (
              <>
            <div className="panel-review-header">
              <div className="kv">
                <span>Branch</span>
                <span className="mono">{git?.branch ?? "main"}</span>
              </div>
              {!readOnlyPeer && <div className="git-actions">
                <button className="chip" type="button" onClick={() => void gitPush()}>
                  <CloudUploadIcon size={13} />Push
                </button>
                {git?.pullRequest && git.pullRequest.state === "OPEN" ? (
                  <button className="chip" type="button" onClick={() => void gitMergePullRequest()}>
                    <GitMergeIcon size={13} />Merge PR
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
                    <GitPullRequestIcon size={13} />{settings?.prDraft ? "Draft PR" : "Pull request"}
                  </button>
                )}
              </div>}
            </div>

            <PullRequestList
              key={`${projectId}/${session?.id ?? ""}`}
              items={pullRequests}
              loading={pullRequestsLoading}
              error={pullRequestsError}
              onSelect={openPullRequest}
              onWork={workOnPullRequest}
              onRefresh={() => {
                forceNextListRead.current = true;
                setListRefreshVersion((value) => value + 1);
              }}
            />

            <div className="panel-review-files">
              <h4>Changed files ({git?.files?.length ?? 0})</h4>
              {(git?.files ?? []).length === 0 ? (
                <p className="faint">Working tree clean.</p>
              ) : (
                git?.files?.map((entry) => (
                  <div className="change-row" key={entry.path}>
                    <button className="list-item" onClick={() => showFileDiff(entry.path)}>
                      <DiffIcon size={12} />
                      <span className="truncate">{entry.path}</span>
                      <span className="meta">{entry.code}</span>
                    </button>
                    {!readOnlyPeer && <span className="change-row-actions">
                      <button type="button" className="icon-btn" title={`Stage ${entry.path}`} aria-label={`Stage ${entry.path}`} onClick={() => void gitStage(entry.path)}>
                        <PlusIcon size={13} />
                      </button>
                      <button type="button" className="icon-btn change-row-discard" title={`Discard changes to ${entry.path}`} aria-label={`Discard changes to ${entry.path}`} onClick={() => gitDiscard(entry.path)}>
                        <UndoIcon size={13} />
                      </button>
                    </span>}
                  </div>
                ))
              )}
            </div>

            {git?.isRepo && !readOnlyPeer && <ReviewCommitForm key={`${projectId}/${session?.id ?? ""}/${session?.workingDirectory ?? project?.workingDirectory ?? ""}`}
              dirty={Boolean(git.dirty)} onCommit={gitCommit} />}

            {git?.isRepo && projectId ? (
              <ReviewDiff key={`${projectId}/${session?.id ?? ""}`} projectId={projectId} sessionId={session?.id} thread={reviewThread}
                selection={diffScope} ignoreWhitespace={ignoreWhitespace} path={reviewPath} onShowAll={() => setReviewPath(undefined)} />
            ) : (
              <div className="panel-diff-section">
                <h4>Diff</h4>
                {artifacts
                  .filter((item) => item.kind === "patch" && item.content)
                  .map((artifact) => (
                    <div key={artifact.id}>
                      <h5>{artifact.title}</h5>
                      <DiffView text={artifact.content ?? ""} />
                    </div>
                  ))}
                {artifacts.every((item) => item.kind !== "patch" || !item.content) && (
                  <p className="faint">No diff to show. This folder is not a git repository.</p>
                )}
              </div>
            )}
              </>
            )}
              </>
            )}
          </div>
        )}

        {activeTool === "browser" && (
          <InspectorHeadSlot.Provider value={headSlot}>
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
          </InspectorHeadSlot.Provider>
        )}

        {/* Keyed by thread: an attach that finishes after a switch must not land on the new thread. */}
        {activeTool === "simulator" && (
          <InspectorHeadSlot.Provider value={headSlot}>
            <SimulatorPane key={session?.id ?? "inbox"} />
          </InspectorHeadSlot.Provider>
        )}

        {activeTool === "agents" && <div className="panel-tool-pane"><ThreadAgents /></div>}

        {activeTool === "compare" && <div className="panel-tool-pane"><ComparePane /></div>}

        {activeTool === "chat" && (
          <div className="panel-tool-pane" ref={chatScroll}>
            <div className="inspector-block">
              <h4>Agents</h4>
              {harnesses.map((harness) => {
                const notReady = SPAWN_BLOCKED[harness.readiness];
                const reason = !projectId
                  ? "Open a project first — an agent starts in its folder."
                  : notReady ?? (busy ? "Waiting for the current request to finish." : undefined);
                return (
                <div className="change-row" key={harness.id}>
                  <div className="list-item" style={{ cursor: "default" }}>
                    <CpuIcon size={12} />
                    <span className="truncate">{harness.name}</span>
                    <span className="meta">{READINESS_LABEL[harness.readiness]}</span>
                  </div>
                  <button
                    type="button"
                    className="chip"
                    disabled={Boolean(reason)}
                    title={reason}
                    onClick={() => void spawnHarness(harness.id)}
                  >
                    Start
                  </button>
                </div>
                );
              })}
            </div>

            {harnessSessions.length > 0 && (
              <div className="inspector-block">
                <h4>Active sessions</h4>
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
                <h4>Run activity</h4>
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
    </>
  );
}
