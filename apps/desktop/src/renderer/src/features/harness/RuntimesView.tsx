import { useState } from "react";
import type { AcpMode, HarnessStatus } from "@capsule/shared";
import { GatewayBanner } from "../shell/GatewayBanner";
import { useWorkspace } from "../../lib/workspace";

const PERMISSION_PROFILES = ["default", "strict", "approve-all"] as const;

function canSpawn(readiness: string): boolean {
  return readiness !== "gateway_offline";
}

function spawnBlockReason(connected: boolean, projectId?: string, folder?: string): string | undefined {
  if (!connected) return "Connect the OpenClaw Gateway before spawning a real ACP session.";
  if (!projectId) return "Select a project first.";
  if (!folder) return "Open a code folder (⌘O). ACP spawn uses it as --cwd.";
  return undefined;
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
  const primary = harnesses.filter((item) => item.id === "claude" || item.id === "codex");
  const others = harnesses.filter((item) => item.id !== "claude" && item.id !== "codex");
  const blockReason = spawnBlockReason(connected, projectId, project?.workingDirectory);
  const extra = showAll
    ? others
    : others.filter(
        (item) =>
          item.binaryPath ||
          item.readiness === "dedicated" ||
          item.readiness === "running" ||
          item.dedicatedProjectIds.length > 0,
      );

  return (
    <section className="panel">
      <div className="panel-inner">
      <div className="panel-header">
        <p>
          ACP harnesses run through OpenClaw acpx on the Gateway host — not inside Capsule, and not
          inside the OpenClaw sandbox. Spawn uses{" "}
          <span className="mono">/acp spawn &lt;id&gt; --bind here --mode {spawnMode}</span>
          {project?.workingDirectory ? " with this folder as cwd." : "."} Codex ACP is the explicit
          fallback; native <span className="mono">/codex</span> stays on the Gateway when that plugin
          is enabled.
        </p>
      </div>
      <GatewayBanner />
      {blockReason && <p className="notice">{blockReason}</p>}
      <div className="card">
        <h3>Project workspace</h3>
        <p className="muted">
          Passed as <span className="mono">--cwd</span>. If omitted, acpx uses the harness default.
          The path must exist on the Gateway host.
        </p>
        <div className="row">
          <div className="mono">{project?.workingDirectory ?? "No working directory"}</div>
          <button className="chip" disabled={!projectId} onClick={() => void pickProjectDirectory()}>
            Choose folder
          </button>
        </div>
        <div className="setting" style={{ marginTop: "0.35rem" }}>
          <div className="setting-copy">
            <div>Spawn mode</div>
            <p>persistent keeps the bound session; oneshot is a single turn then close.</p>
          </div>
          <div className="setting-control">
            <select
              className="field-select"
              value={spawnMode}
              onChange={(event) => setSpawnMode(event.target.value as AcpMode)}
            >
              <option value="persistent">persistent</option>
              <option value="oneshot">oneshot</option>
            </select>
          </div>
        </div>
      </div>
      {primary.map((harness) => (
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
          onDedicate={() => void dedicateHarness(harness.id)}
          onUndedicate={() => void undedicateHarness()}
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
      <div className="card">
        <div className="row">
          <div>
            <h3>Other ACP targets</h3>
            <p className="muted">
              Official acpx harness ids. acpx may fetch adapters on first spawn. Vendor auth still
              has to exist on the Gateway host. Model ids are not portable across harnesses.
            </p>
          </div>
          <button className="ghost" type="button" onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Show detected" : `Show all (${others.length})`}
          </button>
        </div>
        {extra.length === 0 ? (
          <p className="faint">None detected on this Mac. Show all to spawn any official target.</p>
        ) : (
          extra.map((harness) => (
            <div className="row" key={harness.id} style={{ marginTop: 8 }}>
              <div>
                <b>{harness.name}</b>
                <span className="meta" style={{ marginLeft: 8 }}>
                  {harness.id}
                </span>
                <div className="faint">{harness.detail}</div>
              </div>
              <div className="actions" style={{ marginTop: 0 }}>
                <span className={`readiness ${harness.readiness}`}>
                  {harness.readiness.replaceAll("_", " ")}
                </span>
                <button className="ghost" onClick={() => void doctorHarness(harness.id)}>
                  Doctor
                </button>
                <button
                  className="send"
                  disabled={!projectId || busy || !canSpawn(harness.readiness) || !connected}
                  onClick={() => void spawnHarness(harness.id, undefined, { mode: spawnMode })}
                >
                  Spawn
                </button>
              </div>
            </div>
          ))
        )}
      </div>
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
  onDedicate,
  onUndedicate,
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
  live: Array<{ id: string; title: string; harnessState?: string }>;
  canSpawnNow: boolean;
  sessionId?: string;
  connected: boolean;
  onDoctor: () => void;
  onDedicate: () => void;
  onUndedicate: () => void;
  onConnect: () => void;
  onSpawn: () => void;
  onOpen: (id: string) => void;
  onStatus: (id: string) => void;
  onCancel: (id: string) => void;
  onClose: (id: string) => void;
  onOption: (key: "permissions" | "model" | "timeout" | "mode", value: string) => void;
}) {
  return (
    <div className="card">
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
        <button className="chip" onClick={onDoctor}>
          Doctor
        </button>
        <button className="chip" onClick={onDedicate}>
          {dedicated ? "Dedicated" : "Dedicate to project"}
        </button>
        {dedicated && (
          <button className="ghost" onClick={onUndedicate}>
            Remove
          </button>
        )}
        {!connected && (
          <button className="chip" onClick={onConnect}>
            Connect Gateway
          </button>
        )}
        <button className="send" disabled={!canSpawnNow} onClick={onSpawn}>
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
              <button className="list-item" onClick={() => onOpen(item.id)}>
                {item.title}
                <span className="meta">{item.harnessState}</span>
              </button>
              <div className="actions" style={{ marginTop: 0 }}>
                <button className="ghost" onClick={() => onStatus(item.id)}>
                  Status
                </button>
                <button className="ghost" onClick={() => onCancel(item.id)}>
                  Cancel
                </button>
                <button className="danger" onClick={() => onClose(item.id)}>
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
                  if (event.target.value) onOption("permissions", event.target.value);
                }}
              >
                {PERMISSION_PROFILES.map((profile) => (
                  <option key={profile} value={profile}>
                    /acp permissions {profile}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="/acp model"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    const value = event.currentTarget.value.trim();
                    if (value) onOption("model", value);
                  }
                }}
              />
              <input
                type="text"
                placeholder="/acp timeout seconds"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    const value = event.currentTarget.value.trim();
                    if (value) onOption("timeout", value);
                  }
                }}
              />
              <input
                type="text"
                placeholder="/acp set-mode"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    const value = event.currentTarget.value.trim();
                    if (value) onOption("mode", value);
                  }
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
