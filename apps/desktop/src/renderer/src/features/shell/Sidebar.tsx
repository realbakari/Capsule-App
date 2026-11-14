import { useUpdates } from "../../lib/updates";
import { gatewayConnectionLabel } from "../../lib/harness";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { usePanelResize } from "../../lib/panel-resize";
import { threadShelf, type Session } from "@capsule/shared";
import { useSessionActions } from "../triage/session-actions";
import { formatWakeTime, useThreadTriage } from "../../lib/thread-triage";
import {
  buildProjectActionMenuItems,
  copyAnchor,
  type ActionMenuItem,
  type MenuAnchor,
} from "../../lib/action-menu";
import { showNativeContextMenu } from "../../lib/bridge";
import { CHANNEL_PREFS_EVENT, loadChannelPrefs, unreadChannelCount } from "../../lib/channel-prefs";
import {
  compactRelativeTime,
  formatWorkingDurationLabel,
  isWorkingHarnessState,
  latestSidebarRuns,
  indexSidebarThreads,
  groupSidebarThreads,
  readSidebarGrouping,
  SIDEBAR_GROUPING_KEY,
  STATUS_THREAD_PREVIEW,
  visibleStatusThreads,
  SHELF_GROUPS,
  type SidebarGrouping,
  type SidebarStatusGroupId,
  resolveSidebarThreadKind,
  resolveProjectThreadKind,
  SETTLED_THREAD_PREVIEW,
  shouldRecedeThread,
  splitProjectThreads,
  type SidebarThreadKind,
} from "../../lib/sidebar";
import { SETTINGS_TABS } from "../settings/SettingsView";
import { searchSettings } from "../settings/settings-search";
import { useWorkspace, type View } from "../../lib/workspace";
import { ActionMenu } from "./ActionMenu";
import { MenuSelect } from "./MenuSelect";
import { AddProjectPicker, type ProjectSourceId } from "./AddProjectPicker";
import { CloneRepositoryDialog } from "./CloneRepositoryDialog";
import { SidebarToggle } from "./SidebarControl";
import { SidebarThreadPreview } from "./SidebarThreadPreview";
import { useFolderDrop } from "./useFolderDrop";
import { formatUserError } from "../../lib/errors";
import { AgentGlyph } from "./AgentGlyph";
import {
  ArchiveIcon,
  CpuIcon,
  FolderIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  FolderPlusIcon,
  GitBranchIcon,
  HistoryIcon,
  InboxIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PinIcon,
  PlusIcon,
  ChartIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  AlertTriangleIcon,
  SparkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  XIcon,
} from "./icons";

/*
 * The footer rail, not a full navigation. Seven unlabelled glyphs in a 264px
 * column is a puzzle rather than a menu: the eye cannot tell them apart and
 * nothing says what any of them does.
 *
 * Approvals earns its place because it carries a live badge and is
 * time-sensitive; Usage because it is read often. Harnesses, Skills and
 * History are one keystroke away in the command palette, which already lists
 * all three, so dropping them from the rail costs nothing but the clutter.
 */
const LIBRARY: Array<{ id: View; label: string; icon: typeof CpuIcon }> = [
  { id: "channels", label: "Channels", icon: MessageSquareIcon },
  { id: "approvals", label: "Approvals", icon: ShieldIcon },
  { id: "usage", label: "Usage", icon: ChartIcon },
];

interface MenuState {
  kind: "project" | "session";
  id: string;
  items: ActionMenuItem[];
  point: { x: number; y: number };
  anchor?: MenuAnchor;
  keyboard?: boolean;
  location: "recent" | "project";
}

function WorkingDuration({ startedAt }: { startedAt: string }) {
  const startedMs = Date.parse(startedAt);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    const id = window.setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(id);
  }, [startedMs]);
  if (Number.isNaN(startedMs)) return null;
  return (
    <span className="thread-duration">{formatWorkingDurationLabel(Date.now() - startedMs)}</span>
  );
}

export function Sidebar() {
  const {
    projects,
    sessions,
    projectId,
    sessionId,
    api,
    view,
    setView,
    settingsTab,
    setSettingsTab,
    setProjectId,
    createTask,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    createProjectFromFolder,
    pickProjectDirectory,
    addProjectFolder,
    connected,
    status,
    settings,
    renameProject,
    deleteProject,
    renameSession,
    deleteSession,
    archiveSession,
    sidebarWidth,
    sidebarCollapsed,
    setSidebarWidth,
    pinSession,
    reorderPinnedSessions,
    regenerateTitle,
    projectRuns,
    approvals,
    openPath,
    ready,
    harnesses,
    refresh,
    setNotice,
  } = useWorkspace();
  const [menu, setMenu] = useState<MenuState>();
  const sessionActions = useSessionActions();
  const folderDrop = useFolderDrop();
  const triage = useThreadTriage();
  const [openShelves, setOpenShelves] = useState<Set<string>>(new Set());
  const toggleShelf = (key: string) => setOpenShelves((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const sidebarRef = useRef<HTMLElement>(null);
  const focusedInside = useRef(false);
  useLayoutEffect(() => {
    if (!sidebarCollapsed) return;
    setMenu(undefined);
    const restoreFocus = focusedInside.current || sidebarRef.current?.contains(document.activeElement) ||
      Boolean(menu && document.activeElement?.closest(".action-menu"));
    focusedInside.current = false;
    // Chromium may finish blurring an inert descendant after the DOM commit.
    // Hand off on the next frame, once the titlebar has its visible toggle.
    const frame = requestAnimationFrame(() => {
      if (restoreFocus && (document.activeElement === document.body || sidebarRef.current?.contains(document.activeElement))) {
        document.querySelector<HTMLElement>('.workspace [data-sidebar-control]')?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [sidebarCollapsed]);
  const focusProps = {
    ref: sidebarRef,
    inert: Boolean(sidebarCollapsed),
    onFocusCapture: () => { focusedInside.current = true; },
    onBlurCapture: (event: FocusEvent<HTMLElement>) => {
      // Setting inert can blur the focused child during the DOM commit, before
      // the layout effect hands focus to the visible titlebar control.
      if (!event.currentTarget.inert && event.relatedTarget && event.relatedTarget !== document.body &&
        !event.currentTarget.contains(event.relatedTarget)) focusedInside.current = false;
    },
  };
  const [editing, setEditing] = useState<{ kind: "project" | "session"; id: string; value: string; location?: "recent" | "project" }>();
  const [query, setQuery] = useState("");
  const [settingsQuery, setSettingsQuery] = useState("");
  const update = useUpdates();
  const { status: updateResult, busy: checkingUpdate, label: updateLabel, run: runUpdateCheck } = update;
  const [draggedPinnedId, setDraggedPinnedId] = useState<string>();
  const [draggedProjectId, setDraggedProjectId] = useState<string>();
  const [projectDropTarget, setProjectDropTarget] = useState<string>();
  async function moveProject(sourceId: string, targetId: string) {
    const ordered = projects.map((project) => project.id);
    const from = ordered.indexOf(sourceId);
    const to = ordered.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    ordered.splice(from, 1);
    ordered.splice(to, 0, sourceId);
    try { await api.reorderProjects(ordered); await refresh(); }
    catch (error) { setNotice(formatUserError(error)); }
  }
  const [cloneOpen, setCloneOpen] = useState<"git-url" | "github">();
  const [addProjectOpen, setAddProjectOpen] = useState(false);

  /* One entry point, three ways in. */
  function addProject(source: ProjectSourceId) {
    setAddProjectOpen(false);
    if (source === "folder") void createProjectFromFolder();
    else setCloneOpen(source);
  }

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [restLimit, setRestLimit] = useState<Record<string, number>>({});
  const [recentLimit, setRecentLimit] = useState(20);
  const [grouping, setGrouping] = useState(() => readSidebarGrouping(() => localStorage.getItem(SIDEBAR_GROUPING_KEY)));
  const [expandedGroups, setExpandedGroups] = useState<Set<SidebarStatusGroupId>>(new Set());
  const latestRuns = useMemo(() => latestSidebarRuns(projectRuns), [projectRuns]);
  const pendingApprovals = approvals.filter((item) => item.status === "pending").length;
  const askingRuns = useMemo(() => new Set(approvals.filter((item) => item.status === "pending" && item.details?.questions?.length).map((item) => item.runId)), [approvals]);
  const [channelUnread, setChannelUnread] = useState(() => unreadChannelCount(loadChannelPrefs()));
  useEffect(() => {
    const sync = () => setChannelUnread(unreadChannelCount(loadChannelPrefs()));
    window.addEventListener(CHANNEL_PREFS_EVENT, sync);
    return () => window.removeEventListener(CHANNEL_PREFS_EVENT, sync);
  }, []);

  const threadsByProject = useMemo(() => indexSidebarThreads(sessions), [sessions]);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const needle = query.trim().toLowerCase();
  const canReorderProjects = grouping === "project" && !needle && api.isDesktop !== false && projects.length > 1;
  /* Recent is a way of grouping the one list, not a second copy of it under the projects. */
  const recentThreads = useMemo(() => grouping === "recent" ? [...threadsByProject.values()].flat()
    .filter((thread) => projectNames.has(thread.projectId) && threadShelf(thread) !== "snoozed" && (!needle || thread.title.toLowerCase().includes(needle)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) : [], [grouping, threadsByProject, projectNames, needle]);

  const kindOf = (session: Session): SidebarThreadKind => {
    const run = latestRuns.get(session.id);
    return resolveSidebarThreadKind({
      liveHarness: isWorkingHarnessState(session.harnessState),
      runStatus: run?.status,
      runAnswered: run?.hasResult ?? Boolean(run?.result?.trim()),
      runError: run?.error,
    });
  };

  const statusGroups = useMemo(() => grouping === "status" ? groupSidebarThreads(sessions, projects, latestRuns, needle) : [], [grouping, sessions, projects, latestRuns, needle]);

  function changeGrouping(value: string) {
    const next: SidebarGrouping = value === "status" || value === "recent" ? value : "project";
    setGrouping(next);
    setDraggedPinnedId(undefined);
    try { localStorage.setItem(SIDEBAR_GROUPING_KEY, next); }
    catch { /* This view preference remains usable when storage is denied. */ }
  }

  const filteredProjects = useMemo(() => {
    if (!needle) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) ||
        threadsByProject.get(project.id)?.some(
          (session) =>
            session.projectId === project.id && session.title.toLowerCase().includes(needle),
        ),
    );
  }, [threadsByProject, needle, projects]);

  function sessionsFor(projectIdValue: string) {
    const list = threadsByProject.get(projectIdValue) ?? [];
    if (!needle || projectNames.get(projectIdValue)?.toLowerCase().includes(needle)) return list;
    return list.filter((session) => session.title.toLowerCase().includes(needle));
  }

  function runAction(kind: MenuState["kind"], id: string, action: string, location: MenuState["location"]) {
    setMenu(undefined);
    if (kind === "project") {
      const project = projects.find((item) => item.id === id);
      if (action === "settings") {
        setProjectId(id);
        setView("project");
        return;
      }
      if (action === "rename") {
        setEditing({ kind: "project", id, value: project?.name ?? "" });
        return;
      }
      if (action === "new-conversation") {
        setProjectId(id);
        void createTask();
        return;
      }
      if (action === "change-folder") {
        setProjectId(id);
        void pickProjectDirectory(id);
        return;
      }
      if (action === "add-folder") {
        setProjectId(id);
        void addProjectFolder(id);
        return;
      }
      if (action === "open-folder" && project?.workingDirectory) {
        void openPath(project.workingDirectory);
        return;
      }
      if (action === "copy-path" && project?.workingDirectory) {
        void navigator.clipboard.writeText(project.workingDirectory);
        return;
      }
      if (action === "delete") deleteProject(id);
      return;
    }
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    if (sessionActions.run(session, action) === "rename") {
      setEditing({ kind: "session", id, value: session.title, location });
    }
  }

  function itemsFor(kind: MenuState["kind"], id: string): ActionMenuItem[] {
    if (kind === "project") {
      const project = projects.find((item) => item.id === id);
      const inbox = project?.name === "Inbox";
      return buildProjectActionMenuItems({
        hasFolder: Boolean(project?.workingDirectory),
        canDelete: !inbox,
        canRename: !inbox,
      });
    }
    const session = sessions.find((item) => item.id === id);
    return session ? sessionActions.items(session) : [];
  }

  async function openActions(
    event: { preventDefault(): void; stopPropagation(): void; type: string; button?: number; clientX?: number; clientY?: number; currentTarget: EventTarget },
    kind: MenuState["kind"],
    id: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const items = itemsFor(kind, id);
    const target = event.currentTarget as HTMLElement;
    const location = target.closest(".sidebar-recents") ? "recent" : "project";
    const rect = target.getBoundingClientRect();
    const point = { x: event.clientX ?? rect.right, y: event.clientY ?? rect.bottom };
    const fromTrigger = event.type !== "contextmenu";
    const anchor = fromTrigger ? copyAnchor(rect) : undefined;
    const keyboard =
      event.type === "keydown" || (event.type === "contextmenu" && (event.button ?? 0) === 0);
    if (event.type === "contextmenu") {
      const native = await showNativeContextMenu(items, point);
      if (native !== "unavailable") {
        if (native) runAction(kind, id, native, location);
        return;
      }
    }
    setMenu({ kind, id, items, point, anchor, keyboard, location });
  }

  function toggleExpanded(id: string, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openProject(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setProjectId(id);
    setView("chat");
  }

  function openThread(session: Session, event: MouseEvent) {
    if (event.detail > 1) return;
    setProjectId(session.projectId, session.id);
    setView("chat");
  }

  async function commitEdit() {
    if (!editing) return;
    if (editing.kind === "project") await renameProject(editing.id, editing.value);
    else await renameSession(editing.id, editing.value);
    setEditing(undefined);
  }

  const { startResize } = usePanelResize(!sidebarCollapsed);

  function renderThread(session: Session, location: "recent" | "project" = "project") {
    const previewId = `${location}-thread-preview-${session.id}`;
    if (editing?.kind === "session" && editing.id === session.id && (editing.location ?? "project") === location) {
      return (
        <input
          key={session.id}
          autoFocus
          type="text"
          value={editing.value}
          aria-label="Conversation title"
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => void commitEdit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commitEdit();
            if (event.key === "Escape") setEditing(undefined);
          }}
          onClick={(event) => event.stopPropagation()}
        />
      );
    }
    const kind = kindOf(session);
    const active = session.id === sessionId;
    const unread = !active && triage.isUnread(session);
    const shelf = threadShelf(session);
    const recede = !unread && shouldRecedeThread(kind, active);
    const run = latestRuns.get(session.id);
    const startedAt =
      kind === "working" && run && ["running", "queued", "waiting"].includes(run.status)
        ? run.createdAt
        : undefined;
    return (
      <SidebarThreadPreview key={session.id} id={previewId} title={session.title}
        project={projectNames.get(session.projectId)} updatedAt={session.updatedAt} disabled={sidebarCollapsed || Boolean(menu) || Boolean(editing)}>
      <div
        role="button"
        tabIndex={0}
        data-thread-item
        data-menu-open={menu?.kind === "session" && menu.id === session.id ? "true" : undefined}
        /* The row is a button made of divs, so it has no name of its own —
           every conversation in the sidebar read as an unnamed control. */
        aria-label={unread ? `${session.title}, unread` : shelf === "snoozed" && session.snoozedUntil ? `${session.title}, snoozed until ${formatWakeTime(session.snoozedUntil, new Date(), settings?.timeFormat)}` : session.title}
        aria-current={active ? "page" : undefined}
        aria-describedby={previewId}
        className={`thread-row ${location === "recent" ? "sidebar-recent-row" : ""} ${active ? "active" : ""} ${recede ? "recede" : ""} ${unread ? "unread" : ""}`}
        draggable={location === "project" && grouping === "project" && Boolean(session.pinned)}
        onDragStart={(event) => {
          if (grouping !== "project" || !session.pinned) return;
          setDraggedPinnedId(session.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", session.id);
        }}
        onDragEnd={() => setDraggedPinnedId(undefined)}
        onDragOver={(event) => {
          if (location !== "project" || grouping !== "project" || !session.pinned || !draggedPinnedId || draggedPinnedId === session.id) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          if (location !== "project" || grouping !== "project" || !session.pinned) return;
          event.preventDefault();
          const sourceId = draggedPinnedId || event.dataTransfer.getData("text/plain");
          if (!sourceId || sourceId === session.id) return;
          const ordered = sessionsFor(session.projectId)
            .filter((item) => item.pinned)
            .map((item) => item.id);
          const sourceIndex = ordered.indexOf(sourceId);
          const targetIndex = ordered.indexOf(session.id);
          if (sourceIndex < 0 || targetIndex < 0) return;
          ordered.splice(sourceIndex, 1);
          ordered.splice(targetIndex, 0, sourceId);
          setDraggedPinnedId(undefined);
          void reorderPinnedSessions(session.projectId, ordered);
        }}
        onClick={(event) => openThread(session, event)}
        onDoubleClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) return;
          event.preventDefault();
          setEditing({ kind: "session", id: session.id, value: session.title, location });
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setProjectId(session.projectId, session.id);
            setView("chat");
          }
        }}
        onContextMenu={(event) => void openActions(event, "session", session.id)}
      >
        <span className="row-slot" aria-hidden>{unread ? <span className="thread-unread-dot" title="Unread" /> : null}</span>
        <span className="row-slot">
          {session.pinned ? <PinIcon size={11} /> : session.workspaceMode === "worktree" ? (
            <span className="thread-worktree" title={session.worktreeBranch ? `Own worktree on ${session.worktreeBranch}` : "Own worktree"} aria-label="Runs in its own worktree"><GitBranchIcon size={11} /></span>
          ) : null}
        </span>
        <span className="thread-title">
          <span className="truncate">{session.title}</span>
          {grouping !== "project" && <small className="thread-project">{projectNames.get(session.projectId)}</small>}
        </span>
        <span className="thread-meta">
          {kind === "working" ? (
            <span className="thread-status working">
              Working
              {startedAt ? <WorkingDuration startedAt={startedAt} /> : null}
            </span>
          ) : kind === "approval" ? (
            askingRuns.has(run?.id ?? "") ? <span className="thread-status approval"><MessageSquareIcon size={10} />Question</span>
              : <span className="thread-status approval"><ShieldIcon size={10} />Approval</span>
          ) : kind === "failed" ? (
            <span className="thread-status failed"><AlertTriangleIcon size={10} />Failed</span>
          ) : shelf === "snoozed" && session.snoozedUntil ? (
            <span className="thread-wake" title={`Wakes ${formatWakeTime(session.snoozedUntil, new Date(), settings?.timeFormat)}`}>{formatWakeTime(session.snoozedUntil, new Date(), settings?.timeFormat, true)}</span>
          ) : (
            <span className="thread-time">{compactRelativeTime(session.updatedAt)}</span>
          )}
          {/* Which coding agent this conversation runs, at a glance, as its mark rather than its name. */}
          {session.harnessId ? (
            <span className="thread-agent" title={(harnesses ?? []).find((item) => item.id === session.harnessId)?.name ?? session.harnessId}>
              <AgentGlyph id={session.harnessId} name={(harnesses ?? []).find((item) => item.id === session.harnessId)?.name ?? session.harnessId} size={11} />
            </span>
          ) : null}
        </span>
        <span className="thread-quick-actions">
        <button type="button" className="thread-quick-action" aria-label={session.pinned ? "Unpin conversation" : "Pin conversation"}
          title={session.pinned ? "Unpin conversation" : "Pin conversation"}
          onClick={(event) => { event.stopPropagation(); void pinSession(session.id, !session.pinned); }}><PinIcon size={13} /></button>
        <button type="button" className="thread-quick-action" aria-label="Archive conversation" title="Archive conversation"
          onClick={(event) => { event.stopPropagation(); void archiveSession(session.id); }}><ArchiveIcon size={13} /></button>
        <button
          type="button"
          className="thread-more"
          aria-label="Conversation actions"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "session" && menu.id === session.id}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => void openActions(event, "session", session.id)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") void openActions(event, "session", session.id);
          }}
        >
          <MoreHorizontalIcon size={13} />
        </button>
        </span>
      </div>
      </SidebarThreadPreview>
    );
  }

  /*
   * Settings takes over the sidebar rather than opening a second nav column
   * inside the panel. Ten sections is more than anyone keeps in their head, so
   * the nav doubles as a way in by name, and a result names the section it
   * lives in — knowing where a setting is is half the answer.
   */
  if (view === "settings") {
    const results = searchSettings(settingsQuery);
    const searching = settingsQuery.trim().length >= 2;
    return (
      <aside {...focusProps} className="sidebar" data-testid="app-sidebar">
        <div className="sidebar-header">
          <SidebarToggle />
          <span className="brand">Capsule</span>
        </div>
        <div className="sidebar-toolbar">
          <label className="sidebar-search">
            <SearchIcon size={14} />
            <input
              type="search"
              placeholder="Search settings"
              aria-label="Search settings"
              value={settingsQuery}
              onChange={(event) => setSettingsQuery(event.target.value)}
            />
            {settingsQuery ? (
              <button
                type="button"
                className="icon-btn search-clear"
                aria-label="Clear search"
                onClick={() => setSettingsQuery("")}
              >
                <XIcon size={12} />
              </button>
            ) : null}
          </label>
        </div>
        <div className="sidebar-scroll">
          <nav className="settings-nav" aria-label="Settings sections">
            {searching ? (
              results.length === 0 ? (
                <p className="sidebar-empty">No setting matches that.</p>
              ) : (
                results.map((result) => (
                  <button
                    key={`${result.section}:${result.title}`}
                    type="button"
                    className="settings-result"
                    onClick={() => {
                      setSettingsTab(result.section);
                      setSettingsQuery("");
                    }}
                  >
                    <span className="truncate">{result.title}</span>
                    <span className="settings-result-section">{result.sectionLabel}</span>
                  </button>
                ))
              )
            ) : (
              SETTINGS_TABS.map((item) => (
                <Fragment key={item.id}>
                  {item.group ? <h3 className="settings-nav-group">{item.group}</h3> : null}
                  <button
                    type="button"
                    className={settingsTab === item.id ? "active" : ""}
                    aria-current={settingsTab === item.id ? "page" : undefined}
                    onClick={() => setSettingsTab(item.id)}
                  >
                    <item.icon size={14} />
                    {item.label}
                  </button>
                </Fragment>
              ))
            )}
          </nav>
        </div>
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-text-btn"
            onClick={() => setView("chat")}
          >
            <span className="inline-icon">
              <span className="rotate-180" aria-hidden>
                <ChevronRightIcon size={13} />
              </span>
              Back
            </span>
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside {...focusProps} {...folderDrop.handlers} className={`sidebar${folderDrop.over ? " folder-drop-over" : ""}`} data-testid="app-sidebar">
      {folderDrop.over && <div className="sidebar-drop-hint" aria-hidden><FolderPlusIcon size={18} />Drop a folder to add it as a project</div>}
      <div className="sidebar-header">
        <SidebarToggle />
        <span className="brand">Capsule</span>
        <span className="sidebar-history">
          <button type="button" className="icon-btn" title="Back (⌘[)" aria-label="Back" disabled={!canGoBack} onClick={goBack}><ArrowLeftIcon size={14} /></button>
          <button type="button" className="icon-btn" title="Forward (⌘])" aria-label="Forward" disabled={!canGoForward} onClick={goForward}><ArrowRightIcon size={14} /></button>
        </span>
      </div>
      <div className="sidebar-toolbar">
        <label className="sidebar-search">
          <SearchIcon size={14} />
          <input
            type="search"
            placeholder="Search"
            value={query}
            aria-label="Search conversations"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="icon-btn search-clear"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <XIcon size={12} />
            </button>
          ) : null}
        </label>
        <button
          className="icon-btn sidebar-new"
          title="New conversation (⌘N)"
          aria-label="New conversation (⌘N)"
          onClick={() => {
            if (projectId) {
              setCollapsed((current) => {
                const next = new Set(current);
                next.delete(projectId);
                return next;
              });
            }
          void createTask();
          }}
        >
          <PlusIcon size={16} />
          <span>New conversation</span>
        </button>
      </div>
      {/* A scope row rather than a full-width button: the label says what the
          list below is showing, and the action that adds to it sits at its
          end, where the tree's own controls already are. With nothing to scope
          it says nothing — the prompt below is the whole story then. */}
      <div className={`sidebar-scope${projects.length === 0 ? " empty" : ""}`}>
        {ready && projects.length > 0 && <MenuSelect ariaLabel="Group conversations" value={grouping}
          options={[{ id: "project", label: "By project" }, { id: "status", label: "By status" }, { id: "recent", label: "Recent" }]}
          onChange={changeGrouping} />}
        <div className="sidebar-scope-actions">
          <button
            type="button"
            className="icon-btn"
            title="Add project"
            aria-label="Add project"
            onClick={() => setAddProjectOpen(true)}
          >
            <FolderPlusIcon size={13} />
          </button>
        </div>
      </div>
      <div className="sidebar-scroll">
        {/* Loading, empty and "your search found nothing" are three different
            things, and a bare label in the corner said none of them. */}
        {!ready ? (
          <div className="sidebar-loading" aria-label="Loading projects">
            <span className="skeleton skeleton-line medium" />
            <span className="skeleton skeleton-line short" />
            <span className="skeleton skeleton-line medium" />
          </div>
        ) : grouping === "project" && filteredProjects.length === 0 && needle ? (
          <div className="sidebar-empty">No project matches “{needle}”.</div>
        ) : projects.length === 0 ? (
          <div className="sidebar-onboarding">
            <p>No projects yet</p>
            <button type="button" className="chip" onClick={() => setAddProjectOpen(true)}>
              <PlusIcon size={12} /> Add project
            </button>
          </div>
        ) : null}
        {grouping === "status" ? <>
          {statusGroups.map((group) => {
            const expanded = expandedGroups.has(group.id);
            const visible = visibleStatusThreads(group, expanded, sessionId);
            const hidden = group.threads.length - visible.length;
            return <section className="sidebar-status-group" key={group.id} aria-label={group.label}>
              <h3 className="session-label">{group.label}<span>{group.threads.length}</span></h3>
              {visible.map((session) => renderThread(session))}
              {SHELF_GROUPS.has(group.id) ? <button type="button" className="show-more" aria-expanded={expanded} onClick={() => setExpandedGroups((current) => {
                const next = new Set(current);
                if (next.has(group.id)) next.delete(group.id);
                else next.add(group.id);
                return next;
              })}>{expanded ? "Hide" : `Show ${group.label.toLowerCase()}`}</button> : hidden > 0 || (expanded && group.threads.length > STATUS_THREAD_PREVIEW) ? <button type="button" className="show-more" onClick={() => setExpandedGroups((current) => {
                const next = new Set(current);
                if (next.has(group.id)) next.delete(group.id);
                else next.add(group.id);
                return next;
              })}>{hidden > 0 ? `Show ${hidden} more` : "Show fewer"}</button> : null}
            </section>;
          })}
          {ready && projects.length > 0 && statusGroups.length === 0 && <div className="sidebar-empty">{needle ? "No conversations match this search." : "No conversations"}</div>}
        </> : grouping === "recent" ? <section className="sidebar-recents" aria-label="Recent conversations">
          {recentThreads.slice(0, recentLimit).map((thread) => renderThread(thread, "recent"))}
          {recentThreads.length > recentLimit && <button type="button" className="show-more" onClick={() => setRecentLimit((limit) => limit + 20)}>Show more</button>}
          {recentLimit > 20 && <button type="button" className="show-more" onClick={() => setRecentLimit(20)}>Show fewer</button>}
          {ready && projects.length > 0 && recentThreads.length === 0 && <div className="sidebar-empty">{needle ? "No conversations match this search." : "No conversations"}</div>}
        </section> : filteredProjects.map((item) => {
          const threads = sessionsFor(item.id);
          const isOpen = needle ? threads.length > 0 || item.id === projectId : !collapsed.has(item.id);
          const limit = restLimit[item.id] ?? SETTLED_THREAD_PREVIEW;
          const groups = splitProjectThreads(threads, kindOf, needle ? threads.length : limit, threads.find((thread) => thread.id === sessionId));
          const ProjectGlyph = item.name === "Inbox" ? InboxIcon : FolderIcon;
          const liveKind = resolveProjectThreadKind(threads.map(kindOf));
          const conversationCount = threadsByProject.get(item.id)?.length ?? 0;
          return (
            <div key={item.id} className="project-block">
              {editing?.kind === "project" && editing.id === item.id ? (
                <input
                  autoFocus
                  type="text"
                  value={editing.value}
                  aria-label="Project name"
                  onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => void commitEdit()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commitEdit();
                    if (event.key === "Escape") setEditing(undefined);
                  }}
                />
              ) : (
                <SidebarThreadPreview id={`project-preview-${item.id}`} title={item.name}
                  project={`${conversationCount} ${conversationCount === 1 ? "conversation" : "conversations"}`}
                  detail={item.workingDirectory} disabled={sidebarCollapsed || Boolean(menu) || Boolean(editing)}>
                <div
                  role="button"
                  tabIndex={0}
                  className={`project-row ${item.id === projectId ? "active" : ""}${projectDropTarget === item.id && draggedProjectId !== item.id ? " project-drop-target" : ""}`}
                  draggable={canReorderProjects}
                  onDragStart={(event) => {
                    if (!canReorderProjects) return;
                    setDraggedProjectId(item.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-capsule-project", item.id);
                  }}
                  onDragEnd={() => { setDraggedProjectId(undefined); setProjectDropTarget(undefined); }}
                  onDragOver={(event) => {
                    if (!draggedProjectId || !Array.from(event.dataTransfer.types).includes("application/x-capsule-project")) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setProjectDropTarget(item.id);
                  }}
                  onDrop={(event) => {
                    const sourceId = event.dataTransfer.getData("application/x-capsule-project");
                    if (!sourceId) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setDraggedProjectId(undefined);
                    setProjectDropTarget(undefined);
                    void moveProject(sourceId, item.id);
                  }}
                  aria-describedby={`project-preview-${item.id}`}
                  data-menu-open={menu?.kind === "project" && menu.id === item.id ? "true" : undefined}
                  aria-label={item.name}
                  onClick={() => openProject(item.id)}
                  onDoubleClick={() => setEditing({ kind: "project", id: item.id, value: item.name })}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openProject(item.id);
                    }
                  }}
                  onContextMenu={(event) => void openActions(event, "project", item.id)}
                >
                  <button
                    type="button"
                    className="project-toggle"
                    aria-label={isOpen ? "Collapse project" : "Expand project"}
                    aria-expanded={isOpen}
                    onClick={(event) => toggleExpanded(item.id, event)}
                  >
                    {isOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                  </button>
                  <span className="row-slot project-icon">
                    {item.iconDataUrl && item.name !== "Inbox" ? (
                      <img src={item.iconDataUrl} alt="" />
                    ) : (
                      <ProjectGlyph size={14} />
                    )}
                  </span>
                  <span className="truncate">{item.name}</span>
                  <span className="thread-meta">
                    {!isOpen && liveKind ? (
                      <span className={`thread-status ${liveKind === "working" ? "working" : liveKind === "approval" ? "approval" : "failed"}`}>
                        {liveKind === "working" ? "Working" : liveKind === "approval" ? "Approval" : "Failed"}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="thread-more project-new"
                    aria-label={`New conversation in ${item.name}`}
                    title="New conversation here"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setCollapsed((current) => { const next = new Set(current); next.delete(item.id); return next; });
                      void createTask(item.id);
                    }}
                  >
                    <PlusIcon size={13} />
                  </button>
                  <button
                    type="button"
                    className="thread-more"
                    aria-label="Project actions"
                    aria-haspopup="menu"
                    aria-expanded={menu?.kind === "project" && menu.id === item.id}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => void openActions(event, "project", item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") void openActions(event, "project", item.id);
                    }}
                  >
                    <MoreHorizontalIcon size={13} />
                  </button>
                </div>
                </SidebarThreadPreview>
              )}
              {isOpen && (
                <div className="session-list">
                  {threads.length === 0 ? (
                    <div className="sidebar-empty">No conversations</div>
                  ) : (
                    <>
                      {groups.pinned.length > 0 && <div className="session-label">Pinned</div>}
                      {groups.pinned.map((session) => renderThread(session))}
                      {groups.live.map((session) => renderThread(session))}
                      {groups.rest.map((session) => renderThread(session))}
                      {groups.hidden > 0 && (
                        <button
                          type="button"
                          className="show-more"
                          onClick={() =>
                            setRestLimit((current) => ({
                              ...current,
                              [item.id]: (current[item.id] ?? SETTLED_THREAD_PREVIEW) + SETTLED_THREAD_PREVIEW,
                            }))
                          }
                        >
                          Show {groups.hidden} more
                        </button>
                      )}
                      {!needle && limit > SETTLED_THREAD_PREVIEW && <button type="button" className="show-more"
                        onClick={() => setRestLimit((current) => ({ ...current, [item.id]: SETTLED_THREAD_PREVIEW }))}>Show fewer</button>}
                      {([["snoozed", "Snoozed", groups.shelvedSnoozed], ["settled", "Settled", groups.shelvedSettled]] as const).map(([shelfId, label, shelved]) => {
                        if (shelved.length === 0) return null;
                        const key = `${item.id}:${shelfId}`;
                        const open = Boolean(needle) || openShelves.has(key);
                        const shown = open ? shelved : shelved.filter((thread) => thread.id === sessionId);
                        return <Fragment key={shelfId}>
                          <button type="button" className="sidebar-shelf-toggle" aria-expanded={open} onClick={() => toggleShelf(key)}>
                            {open ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
                            {label}<span className="shelf-count">{shelved.length}</span>
                          </button>
                          {shown.map((thread) => renderThread(thread))}
                        </Fragment>;
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="sidebar-footer">
        {update.error || updateResult?.detail || ["update-available", "downloading", "ready-to-install", "installing"].includes(updateResult?.state ?? "") ? (
          <button type="button" className="update-feedback-bubble has-update" onClick={runUpdateCheck} disabled={checkingUpdate} title={updateLabel}>
            <span>{update.error ?? updateResult?.detail ?? `${updateResult?.latest ? `v${updateResult.latest} · ` : ""}${updateLabel}`}</span>
          </button>
        ) : null}
        <div className="sidebar-utils">
          <button
            type="button"
            className="icon-btn"
            title="Settings"
            aria-label="Settings"
            onClick={() => setView("settings")}
          >
            <SettingsIcon size={15} />
          </button>
          {LIBRARY.map((item) => {
            const Icon = item.icon;
            const badge = item.id === "approvals" && pendingApprovals > 0 ? pendingApprovals : item.id === "channels" ? channelUnread : 0;
            return (
              <button
                key={item.id}
                type="button"
                className={`icon-btn ${view === item.id ? "active" : ""}`}
                title={item.label}
                aria-label={item.label}
                onClick={() => setView(item.id)}
              >
                <Icon size={15} />
                {badge > 0 ? <span className="util-badge">{badge > 9 ? "9+" : badge}</span> : null}
              </button>
            );
          })}
          <span className="grow" />
          <button
            type="button"
            className={`icon-btn ${checkingUpdate ? "is-spinning" : ""} ${updateResult?.state === "update-available" ? "has-update" : ""}`}
            title={updateLabel}
            aria-label={updateLabel}
            disabled={checkingUpdate}
            onClick={() => void runUpdateCheck()}
          >
            <RefreshIcon size={14} />
            {updateResult?.state === "update-available" ? <span className="update-dot" /> : null}
          </button>
          <span
            className={`dot ${connected ? "on" : status?.state === "connecting" ? "warn live" : settings?.runtimeMode === "direct" ? "" : "off"}`}
            title={gatewayConnectionLabel(settings?.runtimeMode, connected, status?.state)}
          />
        </div>
      </div>
      <div
        className="sidebar-rail"
        onPointerDown={(event) => startResize(event, (delta) => setSidebarWidth(sidebarWidth + delta))}
        onDoubleClick={() => setSidebarWidth(264)}
        title="Drag to resize"
      />
      {menu ? (
        <ActionMenu
          items={menu.items}
          point={menu.point}
          anchor={menu.anchor}
          keyboard={menu.keyboard}
          onClose={() => setMenu(undefined)}
          onSelect={(action) => runAction(menu.kind, menu.id, action, menu.location)}
        />
      ) : null}
      {addProjectOpen ? (
        <AddProjectPicker onPick={addProject} onClose={() => setAddProjectOpen(false)} />
      ) : null}
      {cloneOpen ? (
        <CloneRepositoryDialog source={cloneOpen} onClose={() => setCloneOpen(undefined)} />
      ) : null}
    </aside>
  );
}
