import { GatewayBanner } from "../shell/GatewayBanner";
import { useWorkspace } from "../../lib/workspace";

const PERMISSION_PROFILES = ["default", "strict", "approve-all"] as const;

function canSpawn(readiness: string): boolean {
  return readiness === "ready" || readiness === "dedicated" || readiness === "running";
}

export function RuntimesView() {
  const {
    harnesses,
    harnessSessions,
    doctors,
    project,
    projectId,
    busy,
    spawnHarness,
    dedicateHarness,
    undedicateHarness,
    doctorHarness,
    pickProjectDirectory,
    setHarnessOption,
    sessionId,
    setSessionId,
    setView,
    closeHarness,
    cancelHarness,
    refreshHarnessStatus,
    connected,
    api,
  } = useWorkspace();

  return (
    <section className="panel">
      <div className="panel-inner">
      <div className="panel-header">
        <p>
          If Claude Code or Codex is already on this Mac or the Gateway host, Capsule picks it up.
        </p>
      </div>
      <GatewayBanner />
      <div className="card">
        <h3>Project workspace</h3>
        <p className="muted">ACP spawn uses this directory as <span className="mono">--cwd</span>.</p>
        <div className="row">
          <div className="mono">{project?.workingDirectory ?? "No working directory"}</div>
          <button className="chip" disabled={!projectId} onClick={() => void pickProjectDirectory()}>
            Choose folder
          </button>
        </div>
      </div>
      {harnesses.map((harness) => {
        const doctor = doctors[harness.id];
        const dedicated = project?.defaultAgentId === harness.id;
        const live = harnessSessions.filter((item) => item.harnessId === harness.id);
        return (
          <div className="card" key={harness.id}>
            <div className="row">
              <div>
                <b>{harness.name}</b>
                <div className="muted">{harness.description}</div>
                <div className="faint">{harness.detail}</div>
                {harness.binaryPath && <div className="mono">{harness.binaryPath}</div>}
              </div>
              <span className={`readiness ${harness.readiness}`}>
                {harness.readiness.replaceAll("_", " ")}
              </span>
            </div>
            {doctor && (
              <div style={{ marginTop: "0.75rem" }}>
                {doctor.checks.map((check) => (
                  <div className="check" key={check.id}>
                    <span className={check.ok ? "ok" : "bad"}>{check.ok ? "●" : "○"}</span>
                    <div>
                      <div className="label">{check.label}</div>
                      <div className="detail">{check.detail}</div>
                    </div>
                  </div>
                ))}
                {doctor.gatewayOutput && <pre className="mono">{doctor.gatewayOutput}</pre>}
              </div>
            )}
            <div className="actions">
              <button className="chip" onClick={() => void doctorHarness(harness.id)}>
                Doctor
              </button>
              <button
                className="chip"
                disabled={!projectId}
                onClick={() => void dedicateHarness(harness.id)}
              >
                {dedicated ? "Dedicated" : "Dedicate to project"}
              </button>
              {dedicated && (
                <button className="ghost" onClick={() => void undedicateHarness()}>
                  Remove
                </button>
              )}
              {!connected && (
                <button className="chip" onClick={() => void api.connectGateway()}>
                  Connect Gateway
                </button>
              )}
              <button
                className="send"
                disabled={!projectId || busy || !canSpawn(harness.readiness)}
                onClick={() => void spawnHarness(harness.id)}
              >
                Spawn session
              </button>
            </div>
            {live.length > 0 && (
              <div style={{ marginTop: "0.85rem" }}>
                <div className="nav-label" style={{ paddingLeft: 0 }}>
                  Live sessions
                </div>
                {live.map((item) => (
                  <div className="row" key={item.id} style={{ marginTop: 8 }}>
                    <button
                      className="list-item"
                      onClick={() => {
                        setSessionId(item.id);
                        setView("chat");
                      }}
                    >
                      {item.title}
                      <span className="meta">{item.harnessState}</span>
                    </button>
                    <div className="actions" style={{ marginTop: 0 }}>
                      <button className="ghost" onClick={() => void refreshHarnessStatus(item.id)}>
                        Status
                      </button>
                      <button className="ghost" onClick={() => void cancelHarness(item.id)}>
                        Cancel
                      </button>
                      <button className="danger" onClick={() => void closeHarness(item.id)}>
                        Close
                      </button>
                    </div>
                  </div>
                ))}
                {sessionId && live.some((item) => item.id === sessionId) && (
                  <div className="actions">
                    <select
                      defaultValue="default"
                      onChange={(event) => {
                        if (event.target.value !== "default") {
                          void setHarnessOption("permissions", event.target.value);
                        }
                      }}
                    >
                      {PERMISSION_PROFILES.map((profile) => (
                        <option key={profile} value={profile}>
                          permissions: {profile}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </section>
  );
}
