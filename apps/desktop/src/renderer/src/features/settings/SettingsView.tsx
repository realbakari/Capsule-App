import { useWorkspace } from "../../lib/workspace";

export function SettingsView() {
  const {
    status,
    subsystems,
    harnesses,
    api,
    newProjectName,
    setNewProjectName,
    createProject,
    createProjectFromFolder,
    diagnostics,
    exportDiagnostics,
    pickProjectDirectory,
    project,
    projects,
    deleteProject,
    setProjectId,
    setView,
  } = useWorkspace();

  return (
    <section className="panel">
      <div className="panel-inner">
      <div className="panel-header">
        <p>Gateway connection, projects, and diagnostics.</p>
      </div>
      <div className="card">
        <h3>OpenClaw</h3>
        <p className="muted">
          Capsule connects to the OpenClaw Gateway as an operator client (protocol{" "}
          {status?.protocol ?? 4}). Claude Code and Codex are spawned there — they are not installed
          in this app.
        </p>
        <div className="grid-2">
          <div>
            <div className="faint">Gateway</div>
            <div>
              {status?.gatewayHost}:{status?.gatewayPort}
            </div>
          </div>
          <div>
            <div className="faint">Agents / sessions / runs</div>
            <div>
              {status?.agentCount ?? 0} / {status?.sessionCount ?? 0} / {status?.activeRunCount ?? 0}
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="send" onClick={() => void api.connectGateway()}>
            Connect
          </button>
          <button className="ghost" onClick={() => void api.disconnectGateway()}>
            Disconnect
          </button>
        </div>
      </div>
      <div className="card">
        <h3>Claude Code · Codex</h3>
        <p className="muted">Detected on this Mac or via the Gateway. Capsule will not install a second copy.</p>
        {harnesses.map((harness) => (
          <div className="row" key={harness.id} style={{ marginBottom: 8 }}>
            <div>
              <b>{harness.name}</b>
              <div className="faint">{harness.detail}</div>
            </div>
            <span className={`readiness ${harness.readiness}`}>
              {harness.readiness.replaceAll("_", " ")}
            </span>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Projects</h3>
        <p className="muted">
          Right-click a project in the sidebar to rename or delete it. Deleting removes Capsule
          history, not the folder on disk.
        </p>
        {projects.map((item) => (
          <div className="row" key={item.id} style={{ marginBottom: 8 }}>
            <button
              className="list-item"
              onClick={() => {
                setProjectId(item.id);
                setView("chat");
              }}
            >
              {item.name}
              <span className="meta">{item.workingDirectory ?? "no folder"}</span>
            </button>
            <button className="danger" onClick={() => deleteProject(item.id)}>
              Delete
            </button>
          </div>
        ))}
        <div className="row">
          <input
            type="text"
            placeholder="Project name"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
          />
          <button className="chip" onClick={() => void createProject()}>
            Create
          </button>
          <button className="ghost" onClick={() => void createProjectFromFolder()}>
            From folder
          </button>
        </div>
        <div className="actions">
          <div className="mono">{project?.workingDirectory ?? "No working directory"}</div>
          <button className="ghost" onClick={() => void pickProjectDirectory()}>
            Choose folder
          </button>
        </div>
      </div>
      <div className="card">
        <h3>Diagnostics</h3>
        <div className="muted">
          Capsule core {subsystems?.capsuleCore} · Gateway {subsystems?.openclawGateway} · Channel{" "}
          {subsystems?.buzz} · Database {subsystems?.database} · Keychain {subsystems?.keychain}
        </div>
        <button className="chip" onClick={() => void exportDiagnostics()}>
          Export sanitized diagnostics
        </button>
        {diagnostics && <pre className="mono">{diagnostics}</pre>}
      </div>
      <div className="card">
        <h3>Shortcuts</h3>
        <div className="kv-list">
          <div className="kv">
            <span>Command palette</span>
            <span className="mono">⌘K</span>
          </div>
          <div className="kv">
            <span>New conversation</span>
            <span className="mono">⌘N</span>
          </div>
          <div className="kv">
            <span>Search files</span>
            <span className="mono">⌘P</span>
          </div>
          <div className="kv">
            <span>Toggle sidebar</span>
            <span className="mono">⌘B</span>
          </div>
          <div className="kv">
            <span>Toggle inspector</span>
            <span className="mono">⌘\\</span>
          </div>
          <div className="kv">
            <span>Send and start another</span>
            <span className="mono">⌘Enter</span>
          </div>
        </div>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          In the composer, type <span className="mono">/</span> for commands,{" "}
          <span className="mono">@</span> to mention a file, or <span className="mono">$</span> to
          attach a skill.
        </p>
      </div>
      </div>
    </section>
  );
}
