import { harnessReadinessLabel, isFeaturedHarness } from "../../lib/harness";
import { harnessCapabilities } from "@capsule/shared";
import { CapabilityDetails } from "./CapabilityDetails";
import { HarnessCatalogRow } from "./HarnessCatalogRow";
import { AgentStoreControls, useCanInstall } from "./AgentStoreControls";
import { useAgentStore } from "./agent-store";
import { SignInDialog } from "./SignInDialog";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  APPROVAL_PRESETS,
  approvalPreset,
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
import { harnessStatusIdentity } from "../../lib/harness-status-cache";

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
    settings,
    api,
  } = useWorkspace();
  const [spawnMode, setSpawnMode] = useState<AcpMode>("persistent");
  const [showAll, setShowAll] = useState(false);
  const [selectedHarnessId, setSelectedHarnessId] = useState<string>();
  const [configuredSessionId, setConfiguredSessionId] = useState<string>();
  const [signInId, setSignInId] = useState<string>();
  const requestedStatuses = useRef(new Set<string>());
  const harnesses = harnessList ?? [];
  const store = useAgentStore();

  /*
   * One list, not a featured card deck and a second list behind a link. The
   * order does the sorting the two lists used to: what you can use now, then
   * what you would have to install. Featured agents stay listed even when they
   * are not installed, so a new computer opens on agents it can install.
   */
  const [available, uninstalled] = useMemo(() => {
    const sorted = [...harnesses].sort((a, b) => {
      if (isFeaturedHarness(a) !== isFeaturedHarness(b)) return isFeaturedHarness(a) ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const shown = (item: HarnessStatus) => isInstalled(item) || isFeaturedHarness(item);
    return [sorted.filter(shown), sorted.filter((item) => !shown(item))];
  }, [harnesses]);
  const listed = showAll ? [...available, ...uninstalled] : available;
  const selectedHarness =
    listed.find((harness) => harness.id === selectedHarnessId) ?? listed[0];
  const routeAvailable = connected || selectedHarness?.runtimeRoute === "direct";
  const blockReason = selectedHarness ? spawnBlockReason(routeAvailable, projectId, project?.workingDirectory) : undefined;
  const needsGateway = selectedHarness ? selectedHarness.runtimeRoute !== "direct" : settings?.runtimeMode !== "direct";
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
    const identity = configuredSession ? harnessStatusIdentity(configuredSession, project) : "";
    if (!id || harnessStatuses[id] || requestedStatuses.current.has(identity)) return;
    requestedStatuses.current.add(identity);
    void refreshHarnessStatus(id).catch(() => {
      requestedStatuses.current.delete(identity);
    });
  }, [configuredSession, project, harnessStatuses, refreshHarnessStatus]);

  return (
    <section className="panel">
      <div className="panel-inner">
        <div className="panel-header">
          <h2>Agents</h2>
          <p>
            Coding agents Capsule can start locally or through an optional Gateway.
          </p>
        </div>
        {needsGateway && <GatewayBanner />}
        {blockReason && <p className="notice">{blockReason}</p>}

        <div className="harness-context-bar">
          <div className="harness-context-folder">
            <span>Project folder</span>
            <strong className="mono">
              {formatProjectRoot(project?.workingDirectory, {
                home: api.homeDir,
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
          <aside className="harness-catalog" aria-label="Available agents">
            <div className="harness-catalog-heading">
              <span>Available</span>
              <small>{available.length}</small>
            </div>
            {listed.map((harness) => {
              const storeRow = store.row(harness.id);
              return <HarnessCatalogRow key={harness.id} id={harness.id} name={harness.name}
                detail={storeRow.kind === "busy" ? `${storeRow.label}…` : isInstalled(harness) ? harnessReadinessLabel(harness.readiness) : "Not installed"}
                selected={selectedHarness?.id === harness.id}
                sessionOpen={harnessSessions.some((item) => item.harnessId === harness.id)}
                onSelect={() => setSelectedHarnessId(harness.id)} />;
            })}
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
              onSignIn={api.isDesktop === false ? undefined : () => setSignInId(selectedHarness.id)}
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
            <div className="harness-detail harness-empty">No agents were reported by the Gateway.</div>
          )}
        </div>

        {signInId && harnesses.some((item) => item.id === signInId) ? (
          <SignInDialog harness={harnesses.find((item) => item.id === signInId)!} onClose={() => setSignInId(undefined)} />
        ) : null}

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
  onSignIn,
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
  live: import("@capsule/shared").Session[];
  activeSessionId?: string;
  status?: HarnessLiveStatus;
  canSpawnNow: boolean;
  connected: boolean;
  onDoctor: () => void;
  onDedicatedChange: (value: boolean) => void;
  onConnect: () => void;
  /** Absent on a paired device: signing in runs programs on the host. */
  onSignIn?: () => void;
  onSpawn: () => void;
  onOpen: (id: string) => void;
  onStatus: (id: string) => void;
  onCancel: (id: string) => void;
  onClose: (id: string) => void;
  onOption: (key: "permissions" | "model" | "timeout" | "mode", value: string) => void;
}) {
  const installed = isInstalled(harness);
  const installable = useCanInstall(harness.id);
  const signedOut = harness.readiness === "needs_login" && harness.loginState !== "config_invalid";
  const activeSession = live.find((item) => item.id === activeSessionId);
  const capabilities = harnessCapabilities({ harness, session: activeSession, status });
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
      <AgentStoreControls harnessId={harness.id} name={harness.name} />

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
        {installed && onSignIn ? (
          <button className={signedOut ? "send" : "chip"} onClick={onSignIn}>
            {signedOut ? "Sign in" : "Manage sign-in"}
          </button>
        ) : null}
        {installed ? (
          <button
            className="send"
            disabled={!canSpawnNow || harness.loginState === "logged_out"}
            /* A signed-out agent would start and fail on its first turn; say what to do instead. */
            title={harness.loginState === "logged_out" ? `${harness.loginHint ?? "Sign in to this agent in a terminal"} first.` : undefined}
            onClick={onSpawn}
          >
            Start a session
          </button>
        ) : installable ? null : (
          <a className="chip" href={harness.installUrl} target="_blank" rel="noreferrer">
            How to install
          </a>
        )}
      </div>

      <CapabilityDetails harness={harness} session={activeSession} status={status} />
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
          {activeSession && capabilities.route !== "direct" && (
            <fieldset className="harness-options" disabled={capabilities.tuning.state === "unavailable"} title={capabilities.tuning.detail}>
              <label>
                <span>Approvals</span>
                <select
                  className="field-select"
                  value={approvalPreset(activeSession.permissionProfile).id}
                  onChange={(event) => {
                    if (event.target.value) onOption("permissions", event.target.value);
                  }}
                >
                  {APPROVAL_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
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
            </fieldset>
          )}
          <HarnessSessionDiagnostics status={status} />
        </div>
      )}
    </section>
  );
}
