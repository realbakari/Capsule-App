import { harnessReadinessLabel, isFeaturedHarness } from "../../lib/harness";
import { useMemo, useState } from "react";
import { PERMISSION_PROFILES, type AcpMode, type HarnessStatus } from "@capsule/shared";
import { AgentGlyph } from "../shell/AgentGlyph";
import { GatewayBanner } from "../shell/GatewayBanner";
import { Switch } from "../settings/controls";
import { formatProjectRoot } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";

function canSpawn(readiness: string): boolean {
  return readiness !== "gateway_offline";
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
  const harnesses = harnessList ?? [];
  const blockReason = spawnBlockReason(connected, projectId, project?.workingDirectory);

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

  return (
    <section className="panel">
      <div className="panel-inner">
        <div className="panel-header">
          <h2>Agents</h2>
          <p>
            Capsule drives the coding agents already installed on this Mac. Turn one on for this
            project and every new conversation here starts with it; you can still pick a different
            agent per conversation in the composer.
          </p>
        </div>
        <GatewayBanner />
        {blockReason && <p className="notice">{blockReason}</p>}

        <div className="card">
          <h3>Project folder</h3>
          <p className="muted">The agent runs in this folder. It has to exist on the Gateway host.</p>
          <div className="row">
            <div className="mono">
              {formatProjectRoot(project?.workingDirectory, {
                home: window.capsule.homeDir,
                fallback: "No folder chosen",
              })}
            </div>
            <button className="chip" disabled={!projectId} onClick={() => void pickProjectDirectory()}>
              Choose folder
            </button>
          </div>
          <div className="setting" style={{ marginTop: "0.35rem" }}>
            <div className="setting-copy">
              <div>Session mode</div>
              <p>Persistent keeps the agent open between turns. Oneshot runs one turn and closes.</p>
            </div>
            <div className="setting-control">
              <select
                className="field-select"
                value={spawnMode}
                onChange={(event) => setSpawnMode(event.target.value as AcpMode)}
              >
                <option value="persistent">Persistent</option>
                <option value="oneshot">Oneshot</option>
              </select>
            </div>
          </div>
        </div>

        {listed.map((harness) => (
          <HarnessCard
            key={harness.id}
            harness={harness}
            doctor={doctors[harness.id]}
            dedicated={project?.defaultAgentId === harness.id}
            live={harnessSessions.filter((item) => item.harnessId === harness.id)}
            canSpawnNow={Boolean(projectId) && !busy && canSpawn(harness.readiness) && connected}
            sessionId={sessionId}
            connected={connected}
            onDoctor={() => void doctorHarness(harness.id)}
            onDedicatedChange={(value) =>
              value ? void dedicateHarness(harness.id) : void undedicateHarness()
            }
            onConnect={() => void api.connectGateway()}
            onSpawn={() => void spawnHarness(harness.id, undefined, { mode: spawnMode })}
            onOpen={(id) => {
              setSessionId(id);
              setView("chat");
            }}
            onStatus={(id) => void refreshHarnessStatus(id)}
            onCancel={(id) => void cancelHarness(id)}
            onClose={(id) => void closeHarness(id)}
            onOption={(key, value) => void setHarnessOption(key, value)}
          />
        ))}

        {uninstalled.length > 0 && (
          <button className="ghost" type="button" onClick={() => setShowAll((value) => !value)}>
            {showAll
              ? "Hide the agents that are not installed"
              : `Show ${uninstalled.length} more Capsule can drive once installed`}
          </button>
        )}

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

function HarnessCard({
  harness,
  doctor,
  dedicated,
  live,
  canSpawnNow,
  sessionId,
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
  live: Array<{ id: string; title: string; harnessState?: string; permissionProfile?: string }>;
  canSpawnNow: boolean;
  sessionId?: string;
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
  return (
    <div className="card">
      <div className="row">
        <div className="harness-identity">
          <AgentGlyph id={harness.id} name={harness.name} size={18} />
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
      <div className="setting">
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
        <button className="chip" onClick={onDoctor}>
          Check this agent
        </button>
        {!connected && (
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
        <div style={{ marginTop: "0.85rem" }}>
          <div className="nav-label" style={{ paddingLeft: 0 }}>
            Open sessions
          </div>
          {live.map((item) => (
            <div className="row" key={item.id} style={{ marginTop: 8 }}>
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
          {sessionId && live.some((item) => item.id === sessionId) && (
            <div className="harness-options">
              <label>
                <span>Permissions</span>
                <select
                  className="field-select"
                  value={live.find((item) => item.id === sessionId)?.permissionProfile ?? "default"}
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
                <input
                  type="text"
                  placeholder="Name a model, then press Enter"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      const value = event.currentTarget.value.trim();
                      if (value) onOption("model", value);
                    }
                  }}
                />
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
        </div>
      )}
    </div>
  );
}
