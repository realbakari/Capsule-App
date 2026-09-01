import { isFeaturedHarness } from "../../lib/harness";
import { useEffect, useState } from "react";
import type { CapsuleSettings, MockScenario } from "@capsule/shared";
import { AppearanceSettings } from "./AppearanceSettings";
import { SETTINGS_SECTION_LABELS, type SettingsSectionId } from "./settings-search";
import {
  AgentDefaultsCard,
  DesktopCard,
  GitCard,
  HarnessCredentialsCard,
  NotificationsCard,
  SessionsCard,
  SkillCatalogCard,
} from "./ConfigurationSettings";
import { AboutCard } from "./AboutModal";
import { SettingRow, Switch } from "./controls";
import { formatProjectRoot } from "../../lib/paths";
import { MODES, useWorkspace } from "../../lib/workspace";

/*
 * Sections a user can name before they open them. The old list had a
 * "Configuration" tab holding seven unrelated cards while "General" held four
 * settings that overlapped them — "Default agent" in one, "Agent defaults" in
 * the other. Each card now sits under the heading someone would look in.
 */
export const SETTINGS_TABS: Array<{ id: SettingsSectionId; label: string }> = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "agents", label: "Agents" },
  { id: "gateway", label: "Gateway" },
  { id: "projects", label: "Projects" },
  { id: "sourceControl", label: "Source control" },
  { id: "skills", label: "Skills" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "about", label: "About" },
];

const SCENARIO_LABELS: Record<MockScenario, string> = {
  successful_run: "Successful run",
  failed_run: "Failed run",
  approval_required: "Approval required",
  verification_failure: "Verification failure",
  multi_agent: "Multi-agent",
  long_running: "Long running",
  disconnected_gateway: "Disconnected gateway",
  buzz_message: "Channel message",
  tool_failure: "Tool failure",
};

export function SettingsView() {
  const {
    status,
    subsystems,
    harnesses: harnessList,
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
    settings,
    updateSettings,
    agents,
    connected,
    settingsTab: tab,
  } = useWorkspace();

  const [url, setUrl] = useState(settings?.gatewayUrl ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (settings?.gatewayUrl) setUrl(settings.gatewayUrl);
  }, [settings?.gatewayUrl]);

  async function patch(next: Partial<CapsuleSettings>) {
    setError(undefined);
    try {
      await updateSettings(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      const next: Partial<CapsuleSettings> = { gatewayUrl: url.trim() };
      if (token.trim()) next.gatewayToken = token.trim();
      await updateSettings(next);
      setToken("");
      await api.connectGateway(url.trim() || undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(undefined);
    try {
      await api.disconnectGateway();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <section className="panel">
        <div className="panel-inner settings-page">
          <div className="panel-header">
            <p>Loading settings…</p>
          </div>
        </div>
      </section>
    );
  }

  const tokenSaved = Boolean(settings.gatewayToken);
  const sendOnEnter = settings.composerSendKey !== "cmd-enter";
  const mock = status?.kind === "mock";

  return (
    <section className="panel">
      <div className="panel-inner settings-page">
        <div className="panel-header">
          <p>Gateway, appearance, agent defaults, and diagnostics for this Mac.</p>
        </div>
        <div className="settings">
          <div className="settings-body">
            <p className="settings-breadcrumb">
              Settings <span aria-hidden>/</span> {SETTINGS_SECTION_LABELS[tab]}
            </p>
            {tab === "general" && (
              <div className="card">
                <h3>General</h3>
                <SettingRow
                  label="Launch at login"
                  hint="Open Capsule when you sign in to this Mac. Requires the packaged app."
                >
                  <Switch
                    checked={settings.launchAtLogin}
                    label="Launch at login"
                    onChange={(value) => void patch({ launchAtLogin: value })}
                  />
                </SettingRow>
                <SettingRow
                  label="Send key"
                  hint={
                    sendOnEnter
                      ? "Enter sends. Shift+Enter inserts a new line. ⌘Enter starts another thread."
                      : "⌘Enter sends. Enter inserts a new line. ⌘⇧Enter starts another thread."
                  }
                >
                  <select
                    className="field-select"
                    value={settings.composerSendKey}
                    onChange={(event) =>
                      void patch({
                        composerSendKey: event.target.value as CapsuleSettings["composerSendKey"],
                      })
                    }
                  >
                    <option value="enter">Enter to send</option>
                    <option value="cmd-enter">⌘Enter to send</option>
                  </select>
                </SettingRow>
              </div>
            )}
            {tab === "general" && (
              <div className="appearance-page">
                <DesktopCard settings={settings} onPatch={(next) => void patch(next)} />
                <NotificationsCard settings={settings} onPatch={(next) => void patch(next)} />
                <SessionsCard settings={settings} onPatch={(next) => void patch(next)} />
              </div>
            )}

            {tab === "appearance" && (
              <AppearanceSettings settings={settings} onPatch={(next) => void patch(next)} />
            )}

            {tab === "agents" && (
              <div className="appearance-page">
                <div className="card">
                  <h3>New conversations</h3>
                  <SettingRow label="Default mode" hint="Used for new conversations.">
                    <select
                      className="field-select"
                      value={settings.defaultMode}
                      onChange={(event) =>
                        void patch({
                          defaultMode: event.target.value as CapsuleSettings["defaultMode"],
                        })
                      }
                    >
                      {MODES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </SettingRow>
                  <SettingRow label="Default agent" hint="Pre-selected when you start a new thread.">
                    <select
                      className="field-select"
                      value={settings.defaultAgentId ?? "general"}
                      onChange={(event) => void patch({ defaultAgentId: event.target.value })}
                    >
                      {agents.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </SettingRow>
                </div>
                <AgentDefaultsCard settings={settings} onPatch={(next) => void patch(next)} />
                <HarnessCredentialsCard settings={settings} onPatch={(next) => void patch(next)} />
              </div>
            )}

            {tab === "sourceControl" && (
              <div className="appearance-page">
                <GitCard settings={settings} onPatch={(next) => void patch(next)} />
              </div>
            )}

            {tab === "skills" && (
              <div className="appearance-page">
                <SkillCatalogCard settings={settings} onPatch={(next) => void patch(next)} />
              </div>
            )}

            {tab === "gateway" && (
              <>
                <div className="card">
                  <h3>OpenClaw Gateway</h3>
                  <p className="muted">
                    Capsule is an operator client (protocol {status?.protocol ?? 4}). It signs a
                    device identity on connect. Claude Code and Codex are spawned on the Gateway —
                    they are not installed in this app.
                  </p>
                  <label className="field">
                    <span>URL</span>
                    <input
                      type="text"
                      value={url}
                      placeholder="ws://127.0.0.1:18789"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setUrl(event.target.value)}
                      onBlur={() => {
                        const next = url.trim();
                        if (next && next !== settings.gatewayUrl) void patch({ gatewayUrl: next });
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Operator token</span>
                    <input
                      type="password"
                      value={token}
                      placeholder={tokenSaved ? "Stored in Keychain" : "Optional on loopback"}
                      autoComplete="off"
                      onChange={(event) => setToken(event.target.value)}
                    />
                  </label>
                  {tokenSaved && (
                    <div className="setting-inline">
                      <span className="faint">A token is saved in the Keychain.</span>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => void patch({ gatewayToken: "" })}
                      >
                        Clear token
                      </button>
                    </div>
                  )}
                  <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                    <div>
                      <div className="faint">Status</div>
                      <div>
                        {connected
                          ? "Connected"
                          : mock
                            ? "Gateway offline · mock runtime"
                            : (status?.state ?? "Disconnected")}
                      </div>
                    </div>
                    <div>
                      <div className="faint">Host</div>
                      <div className="mono">
                        {status?.gatewayHost}:{status?.gatewayPort}
                      </div>
                    </div>
                    <div>
                      <div className="faint">Agents / sessions / runs</div>
                      <div>
                        {status?.agentCount ?? 0} / {status?.sessionCount ?? 0} /{" "}
                        {status?.activeRunCount ?? 0}
                      </div>
                    </div>
                    <div>
                      <div className="faint">Gateway version</div>
                      <div>{status?.openclawVersion ?? "—"}</div>
                    </div>
                  </div>
                  {error && <div className="notice">{error}</div>}
                  <div className="actions">
                    <button className="send" disabled={busy} onClick={() => void connect()}>
                      {busy ? "Connecting…" : "Save & Connect"}
                    </button>
                    <button className="ghost" disabled={busy} onClick={() => void disconnect()}>
                      Disconnect
                    </button>
                  </div>
                </div>
                <div className="card">
                  <h3>Offline</h3>
                  <SettingRow
                    label="Use mock when offline"
                    hint="Keep the workspace usable if the Gateway is not running."
                  >
                    <Switch
                      checked={settings.useMockWhenOffline}
                      label="Use mock when offline"
                      onChange={(value) => void patch({ useMockWhenOffline: value })}
                    />
                  </SettingRow>
                  {settings.useMockWhenOffline && (
                    <SettingRow label="Mock scenario" hint="What the local fallback runtime simulates.">
                      <select
                        className="field-select"
                        value={settings.mockScenario}
                        onChange={(event) =>
                          void patch({ mockScenario: event.target.value as MockScenario })
                        }
                      >
                        {(Object.keys(SCENARIO_LABELS) as MockScenario[]).map((item) => (
                          <option key={item} value={item}>
                            {SCENARIO_LABELS[item]}
                          </option>
                        ))}
                      </select>
                    </SettingRow>
                  )}
                </div>
                <div className="card">
                  <h3>ACP harnesses</h3>
                  <p className="muted">
                    Spawned with <span className="mono">/acp spawn</span> through OpenClaw acpx.
                    Capsule will not install a second copy. Open Harnesses for the full catalog.
                  </p>
                  {(harnessList ?? [])
                    .filter(
                      (harness) =>
                        isFeaturedHarness(harness) ||
                        Boolean(harness.binaryPath) ||
                        harness.readiness === "dedicated" ||
                        harness.readiness === "running",
                    )
                    .map((harness) => (
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
              </>
            )}

            {tab === "projects" && (
              <div className="card">
                <h3>Projects</h3>
                <p className="muted">
                  Inbox is for tasks started outside a repo. ⌘O attaches or changes this project’s
                  folder; New project from folder creates another. Extra folders stay readable
                  while git and new chats use the primary. Deleting a project removes Capsule
                  history, not the folder on disk.
                </p>
                <SettingRow
                  label="Tasks without a project"
                  hint="Default folder for Inbox threads. Each conversation gets a dated subfolder."
                >
                  <div className="setting-stack">
                    <div className="mono setting-path">
                      {formatProjectRoot(settings.projectlessFolder, {
                        home: window.capsule.homeDir,
                        fallback: `${window.capsule.homeDir}/Documents/Capsule`,
                      })}
                    </div>
                    <div className="actions" style={{ marginTop: 0 }}>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => {
                          void (async () => {
                            const directory = await api.pickDirectory();
                            if (directory) await patch({ projectlessFolder: directory });
                          })();
                        }}
                      >
                        Choose folder
                      </button>
                      <button
                        className="ghost"
                        type="button"
                        onClick={() =>
                          void api.openPath(
                            settings.projectlessFolder ||
                              `${window.capsule.homeDir}/Documents/Capsule`,
                          )
                        }
                      >
                        Show in Finder
                      </button>
                      {settings.projectlessFolder && (
                        <button
                          className="ghost"
                          type="button"
                          onClick={() => void patch({ projectlessFolder: "" })}
                        >
                          Use default
                        </button>
                      )}
                    </div>
                  </div>
                </SettingRow>
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
                      <span className="meta">
                        {formatProjectRoot(item.workingDirectory, {
                          home: window.capsule.homeDir,
                          fallback: "no folder",
                        })}
                        {item.extraFolders?.length ? ` +${item.extraFolders.length}` : ""}
                      </span>
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
                  <div className="mono">
                    {formatProjectRoot(project?.workingDirectory, {
                      home: window.capsule.homeDir,
                      fallback: "No working directory",
                    })}
                  </div>
                  <button className="ghost" onClick={() => void pickProjectDirectory()}>
                    Choose folder
                  </button>
                </div>
              </div>
            )}

            {tab === "shortcuts" && (
              <div className="card">
                <h3>Shortcuts</h3>
                <div className="shortcuts-list">
                  {[
                    { label: "Settings", keys: ["⌘", ","] },
                    { label: "Command palette", keys: ["⌘", "K"] },
                    { label: "New conversation", keys: ["⌘", "N"] },
                    { label: "Open folder", keys: ["⌘", "O"] },
                    { label: "Open files", keys: ["⇧", "⌘", "O"] },
                    { label: "Search files", keys: ["⌘", "P"] },
                    { label: "Search in files", keys: ["⇧", "⌘", "F"] },
                    { label: "Toggle sidebar", keys: ["⌘", "B"] },
                    { label: "Toggle inspector", keys: ["⌘", "\\"] },
                    { label: "Inspector review", keys: ["⌃", "⇧", "G"] },
                    { label: "Inspector terminal", keys: ["⌃", "`"] },
                    { label: "Inspector side chat", keys: ["⌥", "⌘", "S"] },
                    { label: "Send", keys: sendOnEnter ? ["Enter"] : ["⌘", "Enter"] },
                    {
                      label: "Send and start another",
                      keys: sendOnEnter ? ["⌘", "Enter"] : ["⌘", "⇧", "Enter"],
                    },
                  ].map((item) => (
                    <div className="shortcut-row" key={item.label}>
                      <span className="shortcut-label">{item.label}</span>
                      <span className="shortcut-keys">
                        {item.keys.map((key, index) => (
                          <kbd key={index}>{key}</kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="muted" style={{ marginTop: "0.75rem" }}>
                  In the composer, type <span className="mono">/</span> for commands,{" "}
                  <span className="mono">@</span> to mention a file, or <span className="mono">$</span>{" "}
                  to attach a skill.
                </p>
              </div>
            )}

            {tab === "diagnostics" && (
              <div className="card">
                <h3>Diagnostics</h3>
                <div className="muted">
                  Capsule core {subsystems?.capsuleCore} · Gateway {subsystems?.openclawGateway} ·
                  Channel {subsystems?.buzz} · Database {subsystems?.database} · Keychain{" "}
                  {subsystems?.keychain}
                </div>
                <div className="actions">
                  <button className="chip" onClick={() => void exportDiagnostics()}>
                    Export sanitized diagnostics
                  </button>
                </div>
                {diagnostics && <pre className="mono">{diagnostics}</pre>}
              </div>
            )}

            {tab === "about" && (
              <div className="card about-settings-wrapper">
                <AboutCard />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
