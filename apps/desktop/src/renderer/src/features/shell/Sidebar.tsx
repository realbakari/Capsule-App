import { useEffect, useMemo, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Session } from "@capsule/shared";
import {
  buildProjectActionMenuItems,
  buildSessionActionMenuItems,
  copyAnchor,
  type ActionMenuItem,
  type MenuAnchor,
} from "../../lib/action-menu";
import { showNativeContextMenu } from "../../lib/bridge";
import {
  compactRelativeTime,
  formatWorkingDurationLabel,
  isWorkingHarnessState,
  latestRunForSession,
  resolveSidebarThreadKind,
  SETTLED_THREAD_PREVIEW,
  shouldRecedeThread,
  splitProjectThreads,
  type SidebarThreadKind,
} from "../../lib/sidebar";
import { useWorkspace, type View } from "../../lib/workspace";
import { ActionMenu } from "./ActionMenu";
import { SidebarToggle } from "./SidebarControl";
import {
  CpuIcon,
  FolderIcon,
  FolderPlusIcon,
  HistoryIcon,
  InboxIcon,
  MoreHorizontalIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SparkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  XIcon,
} from "./icons";

const LIBRARY: Array<{ id: View; label: string; icon: typeof CpuIcon }> = [
  { id: "runtimes", label: "Harnesses", icon: CpuIcon },
  { id: "skills", label: "Skills", icon: SparkIcon },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "approvals", label: "Approvals", icon: ShieldIcon },
];

interface MenuState {
  kind: "project" | "session";
  id: string;
  items: ActionMenuItem[];
  point: { x: number; y: number };
  anchor?: MenuAnchor;
  keyboard?: boolean;
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
    view,
    setView,
    setProjectId,
    createTask,
    createProjectFromFolder,
    connected,
    status,
    renameProject,
    deleteProject,
    renameSession,
    deleteSession,
    archiveSession,
    sidebarWidth,
    setSidebarWidth,
    pinSession,
    regenerateTitle,
    projectRuns,
    approvals,
    openPath,
  } = useWorkspace();
  const [menu, setMenu] = useState<MenuState>();
  const [editing, setEditing] = useState<{ kind: "project" | "session"; id: string; value: string }>();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [restLimit, setRestLimit] = useState<Record<string, number>>({});
  const pendingApprovals = approvals.filter((item) => item.status === "pending").length;

  const activeSessions = sessions.filter((item) => item.state === "active");
  const needle = query.trim().toLowerCase();

  const kindOf = (session: Session): SidebarThreadKind =>
    resolveSidebarThreadKind({
      liveHarness: isWorkingHarnessState(session.harnessState),
      runStatus: latestRunForSession(projectRuns, session.id)?.status,
    });

  const filteredProjects = useMemo(() => {
    if (!needle) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) ||
        activeSessions.some(
          (session) =>
            session.projectId === project.id && session.title.toLowerCase().includes(needle),
        ),
    );
  }, [activeSessions, needle, projects]);

  function sessionsFor(projectIdValue: string) {
    const list = activeSessions.filter((session) => session.projectId === projectIdValue);
    if (!needle) return list;
    return list.filter((session) => session.title.toLowerCase().includes(needle));
  }

  function runAction(kind: MenuState["kind"], id: string, action: string) {
    setMenu(undefined);
    if (kind === "project") {
      const project = projects.find((item) => item.id === id);
      if (action === "rename") {
        setEditing({ kind: "project", id, value: project?.name ?? "" });
        return;
      }
      if (action === "new-conversation") {
        setProjectId(id);
        void createTask();
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
    const folder =
      session?.workingDirectory ||
      projects.find((item) => item.id === session?.projectId)?.workingDirectory;
    if (action === "rename") {
      setEditing({ kind: "session", id, value: session?.title ?? "" });
      return;
    }
    if (action === "pin") {
      void pinSession(id, true);
      return;
    }
    if (action === "unpin") {
      void pinSession(id, false);
      return;
    }
    if (action === "generate-title") {
      void regenerateTitle(id);
      return;
    }
    if (action === "open-folder" && folder) {
      void openPath(folder);
      return;
    }
    if (action === "copy-path" && folder) {
      void navigator.clipboard.writeText(folder);
      return;
    }
    if (action === "archive") {
      void archiveSession(id);
      return;
    }
    if (action === "delete") deleteSession(id);
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
    const folder =
      session?.workingDirectory ||
      projects.find((item) => item.id === session?.projectId)?.workingDirectory;
    return buildSessionActionMenuItems({
      pinned: Boolean(session?.pinned),
      hasFolder: Boolean(folder),
    });
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
    const rect = target.getBoundingClientRect();
    const point = { x: event.clientX ?? rect.right, y: event.clientY ?? rect.bottom };
    const fromTrigger = event.type !== "contextmenu";
    const anchor = fromTrigger ? copyAnchor(rect) : undefined;
    const keyboard =
      event.type === "keydown" || (event.type === "contextmenu" && (event.button ?? 0) === 0);
    if (event.type === "contextmenu") {
      const native = await showNativeContextMenu(items, point);
      if (native !== "unavailable") {
        if (native) runAction(kind, id, native);
        return;
      }
    }
    setMenu({ kind, id, items, point, anchor, keyboard });
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

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const origin = event.clientX;
    const start = sidebarWidth;
    const move = (next: PointerEvent) => {
      setSidebarWidth(start + next.clientX - origin);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function renderThread(session: Session) {
    if (editing?.kind === "session" && editing.id === session.id) {
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
    const recede = shouldRecedeThread(kind, active);
    const run = latestRunForSession(projectRuns, session.id);
    const startedAt =
      kind === "working" && run && ["running", "queued", "waiting"].includes(run.status)
        ? run.createdAt
        : undefined;
    return (
      <div
        key={session.id}
        role="button"
        tabIndex={0}
        data-thread-item
        data-menu-open={menu?.kind === "session" && menu.id === session.id ? "true" : undefined}
        className={`thread-row ${active ? "active" : ""} ${recede ? "recede" : ""}`}
        onClick={(event) => openThread(session, event)}
        onDoubleClick={(event) => {
          event.preventDefault();
          setEditing({ kind: "session", id: session.id, value: session.title });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setProjectId(session.projectId, session.id);
            setView("chat");
          }
        }}
        onContextMenu={(event) => void openActions(event, "session", session.id)}
      >
        <span className="row-slot" aria-hidden />
        <span className="row-slot">
          {session.pinned ? <PinIcon size={11} /> : null}
        </span>
        <span className="truncate">{session.title}</span>
        <span className="thread-meta">
          {kind === "working" ? (
            <span className="thread-status working">
              Working
              {startedAt ? <WorkingDuration startedAt={startedAt} /> : null}
            </span>
          ) : kind === "approval" ? (
            <span className="thread-status approval">Approval</span>
          ) : kind === "failed" ? (
            <span className="thread-status failed">Failed</span>
          ) : (
            <span className="thread-time">{compactRelativeTime(session.updatedAt)}</span>
          )}
        </span>
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
      </div>
    );
  }

  return (
    <aside className="sidebar" data-testid="app-sidebar">
      <div className="sidebar-header">
        <SidebarToggle />
        <div className="brand">
          <span className="truncate">Capsule</span>
        </div>
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
        </button>
      </div>
      <button className="sidebar-text-btn" onClick={() => void createProjectFromFolder()}>
        <span className="inline-icon">
          <FolderPlusIcon size={13} />
          New project
        </span>
      </button>
      <div className="sidebar-scroll">
        {filteredProjects.length === 0 && <div className="sidebar-empty">No projects</div>}
        {filteredProjects.map((item) => {
          const threads = sessionsFor(item.id);
          const isOpen = needle ? threads.length > 0 || item.id === projectId : !collapsed.has(item.id);
          const limit = restLimit[item.id] ?? SETTLED_THREAD_PREVIEW;
          const groups = splitProjectThreads(threads, kindOf, needle ? threads.length : limit);
          const ProjectGlyph = item.name === "Inbox" ? InboxIcon : FolderIcon;
          const liveKind = threads
            .map(kindOf)
            .find((kind) => kind === "approval" || kind === "working" || kind === "failed");
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
                <div
                  role="button"
                  tabIndex={0}
                  className={`project-row ${item.id === projectId ? "active" : ""}`}
                  data-menu-open={menu?.kind === "project" && menu.id === item.id ? "true" : undefined}
                  onClick={() => openProject(item.id)}
                  onDoubleClick={() => setEditing({ kind: "project", id: item.id, value: item.name })}
                  onKeyDown={(event) => {
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
                    onClick={(event) => toggleExpanded(item.id, event)}
                  >
                    {isOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                  </button>
                  <span className="row-slot project-icon">
                    <ProjectGlyph size={14} />
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
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-utils">
          {LIBRARY.map((item) => {
            const Icon = item.icon;
            const badge = item.id === "approvals" && pendingApprovals > 0 ? pendingApprovals : 0;
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
          <button
            type="button"
            className={`icon-btn ${view === "settings" ? "active" : ""}`}
            title="Settings"
            aria-label="Settings"
            onClick={() => setView("settings")}
          >
            <SettingsIcon size={15} />
          </button>
          <span className="grow" />
          <span
            className={`dot ${connected ? "on" : status?.state === "connecting" ? "warn live" : "off"}`}
            title={connected ? "OpenClaw connected" : status?.state === "connecting" ? "Connecting" : "Offline"}
          />
        </div>
      </div>
      <div
        className="sidebar-rail"
        onPointerDown={startResize}
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
          onSelect={(action) => runAction(menu.kind, menu.id, action)}
        />
      ) : null}
    </aside>
  );
}
