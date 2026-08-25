import { useWorkspace } from "../../lib/workspace";

export function Inspector() {
  const { project, session, status, activeRun, steps, artifacts, harnesses } = useWorkspace();
  const dedicated = harnesses.find((item) => item.id === project?.defaultAgentId);

  return (
    <aside className="inspector">
      <div className="inspector-block">
        <h4>Workspace</h4>
        <div className="kv">
          <span>Project</span>
          <span>{project?.name ?? "—"}</span>
        </div>
        <div className="kv">
          <span>Mode</span>
          <span>{session?.mode ?? project?.defaultMode ?? "chat"}</span>
        </div>
        <div className="kv">
          <span>Directory</span>
          <span className="mono">{project?.workingDirectory ?? "not set"}</span>
        </div>
      </div>
      <div className="inspector-block">
        <h4>Harness</h4>
        {dedicated ? (
          <>
            <div className="kv">
              <span>Dedicated</span>
              <span>{dedicated.name}</span>
            </div>
            <div className="kv">
              <span>State</span>
              <span>{session?.harnessState ?? dedicated.readiness.replaceAll("_", " ")}</span>
            </div>
            {session?.openclawSessionKey && (
              <div className="kv">
                <span>ACP</span>
                <span className="mono">{session.openclawSessionKey}</span>
              </div>
            )}
          </>
        ) : (
          <div className="faint">No Claude or Codex dedication. Open Runtimes to bind one.</div>
        )}
      </div>
      <div className="inspector-block">
        <h4>Run</h4>
        {activeRun ? (
          steps.map((step) => (
            <div className={`step ${step.status}`} key={step.id}>
              <span className="glyph">
                {step.status === "complete" ? "✓" : step.status === "active" ? "●" : "○"}
              </span>
              {step.label}
            </div>
          ))
        ) : (
          <div className="faint">Idle</div>
        )}
      </div>
      <div className="inspector-block">
        <h4>Gateway</h4>
        <div className="kv">
          <span>Host</span>
          <span>
            {status?.gatewayHost}:{status?.gatewayPort}
          </span>
        </div>
        <div className="kv">
          <span>Kind</span>
          <span>{status?.kind ?? "—"}</span>
        </div>
      </div>
      {artifacts.length > 0 && (
        <div className="inspector-block">
          <h4>Artifacts</h4>
          {artifacts.map((artifact) => (
            <div key={artifact.id} className="kv">
              <span>{artifact.title}</span>
              <span className="faint">{artifact.kind}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
