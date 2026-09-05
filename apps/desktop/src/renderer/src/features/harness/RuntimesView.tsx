import { harnessReadinessLabel, isFeaturedHarness } from "../../lib/harness";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PERMISSION_PROFILES,
  type AcpMode,
  type HarnessLiveStatus,
  type HarnessStatus,
} from "@capsule/shared";
import { AgentGlyph } from "../shell/AgentGlyph";
import { GatewayBanner } from "../shell/GatewayBanner";
import { Switch } from "../settings/controls";
import { formatProjectRoot } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { HarnessSessionDiagnostics } from "./HarnessSessionDiagnostics";

function canSpawn(readiness: string): boolean {
  return readiness === "ready" || readiness === "dedicated" || readiness === "running";
}

function spawnBlockReason(connected: boolean, projectId?: string, folder?: string): string | undefined {
  if (!connected) return "Connect the OpenClaw Gateway before starting an agent.";
  if (!projectId) return "Select a project first.";
  if (!folder) return "Open a code folder (⌘O). The agent starts in it.";
  return undefined;
}

/** Installed and reachable agents come first; the rest are a longer list. */
function isInstalled(harness: HarnessStatus): boolean {
  return Boolean(
    harness.binaryPath ||
      harness.readiness === "ready" ||
      harness.readiness === "dedicated" ||
      harness.readiness === "running" ||
      harness.dedicatedProjectIds.length > 0,
  );
}

export function RuntimesView() {
  const {
    harnesses: harnessList,
    harnessSessions,
    harnessStatuses,
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
  const [spawnMode, setSpawnMode] = useState<AcpMode>("persistent");
  const [showAll, setShowAll] = useState(false);
  const [selectedHarnessId, setSelectedHarnessId] = useState<string>();
  const [configuredSessionId, setConfiguredSessionId] = useState<string>();
  const requestedStatuses = useRef(new Set<string>());
  const harnesses = harnessList ?? [];

  /*
   * One list, not a featured card deck and a second list behind a link. The
   * order does the sorting the two lists used to: what you can use now, then
   * what you would have to install.
   */
  const [available, uninstalled] = useMemo(() => {
    const sorted = [...harnesses].sort((a, b) => {
      if (isFeaturedHarness(a) !== isFeaturedHarness(b)) return isFeaturedHarness(a) ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return [sorted.filter(isInstalled), sorted.filter((item) => !isInstalled(item))];
  }, [harnesses]);
  const listed = showAll ? [...available, ...uninstalled] : available;
  const selectedHarness =
    listed.find((harness) => harness.id === selectedHarnessId) ?? listed[0];
  const routeAvailable = connected || selectedHarness?.runtimeRoute === "direct";
  const blockReason = spawnBlockReason(routeAvailable, projectId, project?.workingDirectory);
  const selectedSessions = selectedHarness
    ? harnessSessions.filter((item) => item.harnessId === selectedHarness.id)
    : [];
  const configuredSession =
    selectedSessions.find((item) => item.id === configuredSessionId) ??
    selectedSessions.find((item) => item.id === sessionId) ??
    selectedSessions[0];
  const configuredStatus = configuredSession ? harnessStatuses[configuredSession.id] : undefined;

  useEffect(() => {
    const id = configuredSession?.id;
    if (!id || harnessStatuses[id] || requestedStatuses.current.has(id)) return;
    requestedStatuses.current.add(id);
    void refreshHarnessStatus(id).catch(() => {
      requestedStatuses.current.delete(id);
    });
  }, [configuredSession?.id, harnessStatuses, refreshHarnessStatus]);

  return (
    <section className="panel">
      <div className="panel-inner">
        <div className="panel-header">
          <h2>Harnesses</h2>
          <p>
            Coding agents Capsule can start through the OpenClaw Gateway.
          </p>
        </div>
        <GatewayBanner />
        {blockReason && <p className="notice">{blockReason}</p>}

        <div className="harness-context-bar">
          <div className="harness-context-folder">
            <span>Project folder</span>
            <strong className="mono">
              {formatProjectRoot(project?.workingDirectory, {
                home: window.capsule.homeDir,
                fallback: "No folder chosen",
              })}
            </strong>
          </div>
          <div className="harness-context-actions">
            <button className="chip" disabled={!projectId} onClick={() => void pickProjectDirectory()}>
              Change
            </button>
            <select
              aria-label="Session mode"
              value={spawnMode}
              onChange={(event) => setSpawnMode(event.target.value as AcpMode)}
            >
              <option value="persistent">Persistent session</option>
              <option value="oneshot">One turn</option>
            </select>
          </div>
        </div>

        <div className="harness-workspace">
          <aside className="harness-catalog" aria-label="Available harnesses">
            <div className="harness-catalog-heading">
              <span>Available</span>
              <small>{available.length}</small>
            </div>
            {listed.map((harness) => (
              <button
                type="button"
                className={`harness-catalog-row${selectedHarness?.id === harness.id ? " active" : ""}`}
                key={harness.id}
                onClick={() => setSelectedHarnessId(harness.id)}
              >
                <AgentGlyph id={harness.id} name={harness.name} size={17} />
                <span>
                  <b>{harness.name}</b>
                  <small>{isInstalled(harness) ? harnessReadinessLabel(harness.readiness) : "Not installed"}</small>
                </span>
                {harnessSessions.some((item) => item.harnessId === harness.id) ? (
                  <i className="dot on" aria-label="Session open" />
                ) : null}
              </button>
            ))}
            {uninstalled.length > 0 && (
              <button className="harness-show-all" type="button" onClick={() => setShowAll((value) => !value)}>
                {showAll ? "Show installed only" : `Show ${uninstalled.length} more`}
              </button>
            )}
          </aside>

          {selectedHarness ? (
            <HarnessDetail
              harness={selectedHarness}
              doctor={doctors[selectedHarness.id]}
              dedicated={project?.defaultAgentId === selectedHarness.id}
              live={selectedSessions}
              activeSessionId={configuredSession?.id}
              status={configuredStatus}
              canSpawnNow={
                !blockReason && !busy && canSpawn(selectedHarness.readiness)
              }
              connected={connected}
              onDoctor={() => void doctorHarness(selectedHarness.id)}
              onDedicatedChange={(value) =>
                value ? void dedicateHarness(selectedHarness.id) : void undedicateHarness()
              }
              onConnect={() => void api.connectGateway()}
              onSpawn={() => void spawnHarness(selectedHarness.id, undefined, { mode: spawnMode })}
              onOpen={(id) => {
                setSessionId(id);
                setView("chat");
              }}
              onStatus={(id) => {
                setConfiguredSessionId(id);
                void refreshHarnessStatus(id);
              }}
              onCancel={(id) => void cancelHarness(id)}
              onClose={(id) => void closeHarness(id)}
              onOption={(key, value) =>
                void setHarnessOption(key, value, configuredSession?.id)
              }
            />
          ) : (
            <div className="harness-detail harness-empty">No harnesses were reported by the Gateway.</div>
          )}
        </div>

        <details className="card">
          <summary>How Capsule starts an agent</summary>
          <p className="muted">
            Agents run through the OpenClaw acpx plugin on the Gateway host — not inside Capsule and
            not inside the OpenClaw sandbox. Capsule sends{" "}
            <span className="mono">/acp spawn &lt;id&gt; --bind off --mode {spawnMode}</span> with
            the project folder as <span className="mono">--cwd</span>. Standard and Full access set
            the Gateway to <span className="mono">approve-all</span>; Supervised refuses a tool
            rather than asking, because acpx cannot show a prompt. Vendor sign-in stays with the
            agent's own CLI, and model ids are not portable between agents.
          </p>
        </details>
      </div>
    </section>
  );
}

function HarnessDetail({
  harness,
  doctor,
  dedicated,
  live,
  activeSessionId,
  status,
  canSpawnNow,
  connected,
  onDoctor,
  onDedicatedChange,
  onConnect,
  onSpawn,
  onOpen,
  onStatus,
  onCancel,
  onClose,
  onOption,
}: {
  harness: HarnessStatus;
  doctor?: { checks: Array<{ id: string; label: string; ok: boolean; detail: string }>; gatewayOutput?: string };
  dedicated: boolean;
  live: Array<{
    id: string;
    title: string;
    harnessState?: string;
    permissionProfile?: string;
    modelOverride?: string;
  }>;
  activeSessionId?: string;
  status?: HarnessLiveStatus;
  canSpawnNow: boolean;
  connected: boolean;
  onDoctor: () => void;
  onDedicatedChange: (value: boolean) => void;
  onConnect: () => void;
  onSpawn: () => void;
  onOpen: (id: string) => void;
  onStatus: (id: string) => void;
  onCancel: (id: string) => void;
  onClose: (id: string) => void;
  onOption: (key: "permissions" | "model" | "timeout" | "mode", value: string) => void;
}) {
  const installed = isInstalled(harness);
  const activeSession = live.find((item) => item.id === activeSessionId);
  const advertisedModels = status?.parsed?.models?.availableModels ?? [];
  const currentModel =
    activeSession?.modelOverride ??
    status?.parsed?.models?.currentModelId ??
    status?.parsed?.model ??
    "";
  return (
    <section className="harness-detail">
      <div className="harness-detail-head">
        <div className="harness-identity">
          <AgentGlyph id={harness.id} name={harness.name} size={24} />
          <div>
            <b>{harness.name}</b>
            <div className="muted">{harness.description}</div>
            {harness.binaryPath ? (
              <div className="mono">{harness.binaryPath}</div>
            ) : (
              <div className="faint">{harness.detail}</div>
            )}
          </div>
        </div>
        <span className={`readiness ${harness.readiness}`}>
          {harnessReadinessLabel(harness.readiness)}
        </span>
      </div>

      {/* The old control was one button whose label flipped to "Dedicated",
          so it never said whether that was the state or what a click would do. */}
      <div className="setting harness-dedication">
        <div className="setting-copy">
          <div>Use for this project</div>
          <p>New conversations here start with this agent.</p>
        </div>
        <div className="setting-control">
          <Switch
            checked={dedicated}
            onChange={onDedicatedChange}
            label={`Use ${harness.name} for this project`}
          />
        </div>
      </div>

      {doctor && (
        <div className="harness-doctor">
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

      <div className="actions harness-primary-actions">
        <button className="chip" onClick={onDoctor}>
          Check this agent
        </button>
        {!connected && harness.runtimeRoute !== "direct" && (
          <button className="chip" onClick={onConnect}>
            Connect Gateway
          </button>
        )}
        {installed ? (
          <button className="send" disabled={!canSpawnNow} onClick={onSpawn}>
            Start a session
          </button>
        ) : (
          <a className="chip" href={harness.installUrl} target="_blank" rel="noreferrer">
            How to install
          </a>
        )}
      </div>

      {live.length > 0 && (
        <div className="harness-live-sessions">
          <div className="nav-label">
            Open sessions
          </div>
          {live.map((item) => (
            <div className="harness-session-row" key={item.id}>
              <button className="list-item" onClick={() => onOpen(item.id)}>
                {item.title}
                <span className="meta">{item.harnessState}</span>
              </button>
              <div className="actions" style={{ marginTop: 0 }}>
                <button className="ghost" onClick={() => onStatus(item.id)}>
                  Refresh
                </button>
                <button className="ghost" onClick={() => onCancel(item.id)}>
                  Cancel turn
                </button>
                <button className="danger" onClick={() => onClose(item.id)}>
                  Close
                </button>
              </div>
            </div>
          ))}
          {activeSession && (
            <div className="harness-options">
              <label>
                <span>Permissions</span>
                <select
                  className="field-select"
                  value={activeSession.permissionProfile ?? "default"}
                  onChange={(event) => {
                    if (event.target.value) onOption("permissions", event.target.value);
                  }}
                >
                  {PERMISSION_PROFILES.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Model</span>
                {advertisedModels.length > 0 ? (
                  <select
                    className="field-select"
                    value={currentModel}
                    onChange={(event) => {
                      if (event.target.value) onOption("model", event.target.value);
                    }}
                  >
                    {currentModel &&
                      !advertisedModels.some((model) => model.modelId === currentModel) && (
                        <option value={currentModel}>{currentModel}</option>
                      )}
                    {!currentModel && <option value="">Choose a model</option>}
                    {advertisedModels.map((model) => (
                      <option key={model.modelId} value={model.modelId}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    key={currentModel}
                    type="text"
                    defaultValue={currentModel}
                    placeholder="Model id, then press Enter"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        const value = event.currentTarget.value.trim();
                        if (value) onOption("model", value);
                      }
                    }}
                  />
                )}
                <small className="muted">
                  {advertisedModels.length > 0
                    ? `${advertisedModels.length} ${advertisedModels.length === 1 ? "model" : "models"} reported by ${harness.name}.`
                    : status
                      ? `${harness.name} did not advertise a model list; enter a supported model id.`
                      : "Loading models from the live ACP session…"}
                </small>
              </label>
              <label>
                <span>Turn timeout</span>
                <input
                  type="text"
                  placeholder="Seconds, then Enter"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      const value = event.currentTarget.value.trim();
                      if (value) onOption("timeout", value);
                    }
                  }}
                />
              </label>
              <label>
                <span>Agent mode</span>
                <input
                  type="text"
                  placeholder="The agent's own mode, then Enter"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      const value = event.currentTarget.value.trim();
                      if (value) onOption("mode", value);
                    }
                  }}
                />
              </label>
            </div>
          )}
          <HarnessSessionDiagnostics status={status} />
        </div>
      )}
    </section>
  );
}
