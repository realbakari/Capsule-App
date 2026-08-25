import { useWorkspace, type View } from "../../lib/workspace";

const LIBRARY: Array<{ id: View; label: string }> = [
  { id: "runtimes", label: "Runtimes" },
  { id: "skills", label: "Skills" },
  { id: "history", label: "History" },
  { id: "approvals", label: "Approvals" },
  { id: "settings", label: "Settings" },
];

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
    connected,
    status,
  } = useWorkspace();

  return (
    <aside className="sidebar" data-testid="app-sidebar">
      <button className="new-task" onClick={() => void createTask()}>
        New task
      </button>
      <div className="sidebar-scroll">
        <div className="nav-label">Projects</div>
        {projects.map((item) => (
          <div key={item.id}>
            <button
              className={`list-item ${item.id === projectId ? "active" : ""}`}
              data-active={item.id === projectId}
              onClick={() => {
                setProjectId(item.id);
                setView("chat");
              }}
            >
              {item.name}
              {item.defaultAgentId ? <span className="meta">{item.defaultAgentId}</span> : null}
            </button>
            {item.id === projectId && (
              <div className="session-list">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    className={`list-item ${session.id === sessionId ? "active" : ""}`}
                    onClick={() => {
                      setSessionId(session.id);
                      setView("chat");
                    }}
                  >
                    {session.title}
                    {session.harnessId ? <span className="meta">{session.harnessId}</span> : null}
                  </button>
                ))}
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
          {connected ? "OpenClaw connected" : status?.kind === "mock" ? "Local mock" : "Gateway offline"}
        </button>
      </div>
    </aside>
  );
}
