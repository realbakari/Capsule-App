import { useMemo, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useWorkspace, type View } from "../../lib/workspace";
import {
  CpuIcon,
  FolderPlusIcon,
  HistoryIcon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SparkIcon,
} from "./icons";

const LIBRARY: Array<{ id: View; label: string; icon: typeof CpuIcon }> = [
  { id: "runtimes", label: "Runtimes", icon: CpuIcon },
  { id: "skills", label: "Skills", icon: SparkIcon },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "approvals", label: "Approvals", icon: ShieldIcon },
];

interface MenuState {
  x: number;
  y: number;
  kind: "project" | "session";
  id: string;
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
    setSessionId,
    createTask,
    createProjectFromFolder,
    connected,
    status,
    renameProject,
    deleteProject,
    renameSession,
    deleteSession,
    archiveSession,
    toggleSidebar,
    sidebarWidth,
    setSidebarWidth,
  } = useWorkspace();
  const [menu, setMenu] = useState<MenuState>();
  const [editing, setEditing] = useState<{ kind: "project" | "session"; id: string; value: string }>();
  const [query, setQuery] = useState("");
  const activeSessions = sessions.filter((item) => item.state === "active");
  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        (item.id === projectId &&
          activeSessions.some((session) => session.title.toLowerCase().includes(needle))),
    );
  }, [activeSessions, projectId, projects, query]);
  const visibleSessions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return activeSessions;
    return activeSessions.filter((item) => item.title.toLowerCase().includes(needle));
  }, [activeSessions, query]);

  function openMenu(event: MouseEvent, kind: MenuState["kind"], id: string) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, kind, id });
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

  return (
    <aside className="sidebar" data-testid="app-sidebar" onClick={() => setMenu(undefined)}>
      <div className="sidebar-header">
        <div className="brand">
          <img className="mark" src="./icon.png" alt="" width={20} height={20} />
          Capsule
        </div>
        <span className="grow" />
        <button className="icon-btn" title="Hide sidebar (⌘B)" onClick={toggleSidebar}>
          <PanelLeftIcon />
        </button>
      </div>
      <div className="sidebar-tools">
        <button className="sidebar-cta" onClick={() => void createTask()}>
          <PlusIcon size={14} />
          New conversation
        </button>
        <button className="sidebar-text-btn" onClick={() => void createProjectFromFolder()}>
          <span className="inline-icon">
            <FolderPlusIcon size={13} />
            New project
          </span>
        </button>
      </div>
      <label className="sidebar-search">
        <SearchIcon size={13} />
        <input
          type="search"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="sidebar-scroll">
        <div className="nav-label">Projects</div>
        {filteredProjects.length === 0 && <div className="sidebar-empty">No projects</div>}
        {filteredProjects.map((item) => (
          <div key={item.id}>
            {editing?.kind === "project" && editing.id === item.id ? (
              <input
                autoFocus
                type="text"
                value={editing.value}
                onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                onBlur={() => void commitEdit()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void commitEdit();
                  if (event.key === "Escape") setEditing(undefined);
                }}
              />
            ) : (
              <button
                className={`list-item ${item.id === projectId ? "active" : ""}`}
                data-active={item.id === projectId}
                onClick={() => {
                  setProjectId(item.id);
                  setView("chat");
                }}
                onContextMenu={(event) => openMenu(event, "project", item.id)}
              >
                {item.name}
                {item.defaultAgentId ? <span className="meta">{item.defaultAgentId}</span> : null}
              </button>
            )}
            {item.id === projectId && (
              <div className="session-list">
                {visibleSessions.map((session) =>
                  editing?.kind === "session" && editing.id === session.id ? (
                    <input
                      key={session.id}
                      autoFocus
                      type="text"
                      value={editing.value}
                      onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                      onBlur={() => void commitEdit()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void commitEdit();
                        if (event.key === "Escape") setEditing(undefined);
                      }}
                    />
                  ) : (
                    <button
                      key={session.id}
                      className={`list-item ${session.id === sessionId ? "active" : ""}`}
                      onClick={() => {
                        setSessionId(session.id);
                        setView("chat");
                      }}
                      onContextMenu={(event) => openMenu(event, "session", session.id)}
                    >
                      {session.title}
                      {session.harnessId ? <span className="meta">{session.harnessId}</span> : null}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
        <div className="nav-label">Library</div>
        {LIBRARY.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => setView(item.id)}
            >
              <Icon size={14} />
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="sidebar-footer">
        <button className="list-item" onClick={() => setView("settings")}>
          <SettingsIcon size={14} />
          Settings
          <span className="meta">
            <span className={`dot ${connected ? "on" : status?.state === "connecting" ? "warn" : "off"}`} />
          </span>
        </button>
      </div>
      <div
        className="sidebar-rail"
        onPointerDown={startResize}
        onDoubleClick={() => setSidebarWidth(264)}
        title="Drag to resize"
      />
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          {menu.kind === "project" ? (
            <>
              <button
                onClick={() => {
                  const project = projects.find((item) => item.id === menu.id);
                  setEditing({ kind: "project", id: menu.id, value: project?.name ?? "" });
                  setMenu(undefined);
                }}
              >
                Rename
              </button>
              <button
                onClick={() => {
                  setProjectId(menu.id);
                  void createTask();
                  setMenu(undefined);
                }}
              >
                New conversation
              </button>
              <button
                className="danger-item"
                onClick={() => {
                  deleteProject(menu.id);
                  setMenu(undefined);
                }}
              >
                Delete project
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  const session = sessions.find((item) => item.id === menu.id);
                  setEditing({ kind: "session", id: menu.id, value: session?.title ?? "" });
                  setMenu(undefined);
                }}
              >
                Rename
              </button>
              <button
                onClick={() => {
                  void archiveSession(menu.id);
                  setMenu(undefined);
                }}
              >
                Archive
              </button>
              <button
                className="danger-item"
                onClick={() => {
                  deleteSession(menu.id);
                  setMenu(undefined);
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
