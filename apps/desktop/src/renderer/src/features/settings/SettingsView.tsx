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
    diagnostics,
    exportDiagnostics,
    pickProjectDirectory,
    project,
  } = useWorkspace();

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Settings</h2>
        <p>Gateway connection, projects, and diagnostics.</p>
      </div>
      <div className="card">
        <h3>OpenClaw</h3>
        <p className="muted">
          Capsule connects as an operator client to the Gateway WebSocket control plane (protocol{" "}
          {status?.protocol ?? 4}).
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
        <p className="muted">
          First-class ACP runtimes. Capsule does not reimplement Claude or Codex; it spawns them
          through OpenClaw acpx.
        </p>
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
        <h3>Create project</h3>
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
          Capsule core {subsystems?.capsuleCore} · Gateway {subsystems?.openclawGateway} · Buzz{" "}
          {subsystems?.buzz} · Database {subsystems?.database} · Keychain {subsystems?.keychain}
        </div>
        <button className="chip" onClick={() => void exportDiagnostics()}>
          Export sanitized diagnostics
        </button>
        {diagnostics && <pre className="mono">{diagnostics}</pre>}
      </div>
    </section>
  );
}
