import { useState, type MouseEvent } from "react";
import { useWorkspace, type View } from "../../lib/workspace";

const LIBRARY: Array<{ id: View; label: string }> = [
  { id: "runtimes", label: "Runtimes" },
  { id: "skills", label: "Skills" },
  { id: "history", label: "History" },
  { id: "approvals", label: "Approvals" },
  { id: "settings", label: "Settings" },
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
  } = useWorkspace();
  const [menu, setMenu] = useState<MenuState>();
  const [editing, setEditing] = useState<{ kind: "project" | "session"; id: string; value: string }>();
  const activeSessions = sessions.filter((item) => item.state === "active");

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

  return (
    <aside className="sidebar" data-testid="app-sidebar" onClick={() => setMenu(undefined)}>
      <button className="new-task" onClick={() => void createTask()}>
        New task
      </button>
      <button className="ghost" style={{ width: "100%", marginBottom: "0.75rem" }} onClick={() => void createProjectFromFolder()}>
        New project
      </button>
      <div className="sidebar-scroll">
        <div className="nav-label">Projects</div>
        {projects.map((item) => (
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
                {activeSessions.map((session) =>
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
        {LIBRARY.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${view === item.id ? "active" : ""}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className="list-item" onClick={() => setView("settings")}>
          <span className={`dot ${connected ? "on" : status?.state === "connecting" ? "warn" : "off"}`} />
          {connected ? "OpenClaw connected" : "Gateway offline"}
        </button>
      </div>
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
