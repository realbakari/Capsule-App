import { isFeaturedHarness } from "../../lib/harness";
import { useEffect, useState } from "react";
import type { CapsuleSettings, WritableScope } from "@capsule/shared";
import { routeSettingsPatch, sectionTakesProjectValues, settingsFileTarget, settingsLayerView, type SettingSourceChip } from "../../lib/config-view";
import { SaveToControl, SettingSourceContext, type SettingSourceState } from "../customization/SettingSource";
import { CustomizationDoctor } from "../customization/CustomizationDoctor";
import { PermissionRulesCard } from "../customization/PermissionRulesCard";
import { AppearanceSettings } from "./AppearanceSettings";
import { KeybindingsSettings } from "./KeybindingsSettings";
import { ProcessMonitor } from "./ProcessMonitor";
import { PerformanceDiagnostics } from "./PerformanceDiagnostics";
import { RuntimeModeRow } from "./RuntimeModeRow";
import { useRevealSetting } from "./reveal";
import { SourceControlTools } from "./SourceControlTools";
import { WorktreeStorage } from "./WorktreeStorage";
import { OpenInSettings } from "../open-in/OpenInSettings";
import {
  SETTINGS_SECTION_LABELS,
  SECTIONS_WITH_DEFAULTS,
  type SettingsSectionId,
} from "./settings-search";
import {
  ChatCard,
  ConfirmationsCard,
  ConversationsCard,
  DesktopCard,
  GatewayApiKeysRow,
  GitCard,
  HarnessProvidersCard,
  NewConversationsCard,
  NotificationsCard,
  RepliesCard,
  SkillCatalogCard,
} from "./ConfigurationSettings";
import { AboutCard } from "./AboutModal";
import { CommandsCard } from "./CommandsCard";
import { McpServersSettings } from "../customization/McpServersSettings";
import { AutomationsSettings } from "../automations/AutomationsSettings";
import { StatusLineSettings } from "../status-line/StatusLineSettings";
import { ProfilesCard, ResponseStyleCard } from "../customization/ProfilesCard";
import { RemoteAccessSettings } from "./RemoteAccessSettings";
import { AnalyticsSettings } from "./AnalyticsSettings";
import { PlanModeCard } from "./PlanModeSettings";
import { SavedPromptsSettings } from "./SavedPromptsSettings";
import { TagsSettings } from "../threads/TagsSettings";
import { AdvancedRows, SettingRow } from "./controls";
import { PluginsPanel } from "../plugins/PluginsPanel";
import { ChartIcon, CpuIcon, FileIcon, FolderIcon, GitBranchIcon, GridIcon, HistoryIcon, InfoIcon, KeyboardIcon, LinkIcon, SettingsIcon, SparkIcon, SunIcon, UndoIcon, WrenchIcon } from "../shell/icons";
import { formatProjectRoot } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";

/*
 * Sections a user can name before they open them. The old list had a
 * "Configuration" tab holding seven unrelated cards while "General" held four
 * settings that overlapped them — "Default agent" in one, "Agent defaults" in
 * the other. Each card now sits under the heading someone would look in.
 */
/* Each section has a mark and, after the first two, a small group heading, so the list scans at a glance. */
export const SETTINGS_TABS: Array<{ id: SettingsSectionId; label: string; icon: typeof SettingsIcon; group?: string }> = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "appearance", label: "Appearance", icon: SunIcon },
  { id: "agents", label: "Agents", icon: CpuIcon, group: "Runtime" },
  { id: "tools", label: "Tools (MCP)", icon: WrenchIcon },
  { id: "gateway", label: "Gateway", icon: LinkIcon },
  { id: "projects", label: "Projects", icon: FolderIcon, group: "Code" },
  { id: "sourceControl", label: "Source control", icon: GitBranchIcon },
  { id: "skills", label: "Skills", icon: SparkIcon },
  { id: "automations", label: "Automations", icon: HistoryIcon },
  { id: "plugins", label: "Plugins", icon: GridIcon },
  { id: "shortcuts", label: "Shortcuts", icon: KeyboardIcon, group: "App" },
  { id: "diagnostics", label: "Diagnostics", icon: ChartIcon },
  { id: "about", label: "About", icon: InfoIcon },
];


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
    settings: userSettings,
    updateSettings,
    config,
    setConfigValue,
    agents,
    connected,
    settingsTab: tab,
    setConfirm,
    resetSettingsSection: resetSection,
    refresh,
  } = useWorkspace();

  const [url, setUrl] = useState(userSettings?.gatewayUrl ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useRevealSetting(tab);
  /* Where changes go while a project is open. Back to You when the project changes. */
  const [saveTo, setSaveTo] = useState<{ projectId?: string; scope: WritableScope }>({ scope: "user" });
  const projectConfig = config?.project;
  const target: WritableScope = projectConfig && saveTo.projectId === projectConfig.projectId ? saveTo.scope : "user";
  const canWriteFiles = api.isDesktop === true && !config?.safeMode;

  useEffect(() => {
    if (userSettings?.gatewayUrl) setUrl(userSettings.gatewayUrl);
  }, [userSettings?.gatewayUrl]);

  function fail(caught: unknown) {
    setError(caught instanceof Error ? caught.message : String(caught));
  }

  async function patch(next: Partial<CapsuleSettings>) {
    setError(undefined);
    try {
      const { user, layer } = routeSettingsPatch(next, target);
      for (const { key, value } of layer) await setConfigValue({ key, value, scope: target, projectId: projectConfig?.projectId });
      if (Object.keys(user).length) await updateSettings(user);
    } catch (caught) {
      fail(caught);
    }
  }

  function openSource(chip: SettingSourceChip) {
    setError(undefined);
    const opened = chip.layer === "legacy" || chip.layer === "plugin" ? api.openPath(chip.path) : api.configOpenFile(settingsFileTarget(chip.layer, projectConfig?.projectId));
    void Promise.resolve(opened).catch(fail);
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

  if (!userSettings) {
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

  const view = settingsLayerView(userSettings, config, target);
  const settings = view.settings;
  const sources: SettingSourceState = {
    view,
    projectOverrides: target === "user" ? projectConfig?.provenance : undefined,
    editable: canWriteFiles,
    open: openSource,
    reset: (key, layer) => {
      setError(undefined);
      void setConfigValue({ key, scope: layer, projectId: projectConfig?.projectId }).catch(fail);
    },
  };
  const fileScope: WritableScope = sectionTakesProjectValues(tab) ? target : "user";
  const tokenSaved = Boolean(settings.gatewayToken);

  return (
    <SettingSourceContext.Provider value={sources}>
    <section className="panel">
      <div className="panel-inner settings-page">
        <div className="settings">
          <div className="settings-body">
            <div className="settings-crumbbar">
              {/* One heading per page: the section's name. The titlebar already says Settings. */}
              <h2 className="settings-title">{SETTINGS_SECTION_LABELS[tab]}</h2>
              {SECTIONS_WITH_DEFAULTS.has(tab) && api.isDesktop === true && (
              <div className="settings-crumb-actions">
                {canWriteFiles && (
                  <button
                    type="button"
                    className="ghost"
                    title={fileScope === "user" ? "Your user settings file" : `This project's ${fileScope === "local" ? "personal" : "shared"} settings file`}
                    onClick={() => {
                      setError(undefined);
                      void api.configOpenFile(settingsFileTarget(fileScope, projectConfig?.projectId)).catch(fail);
                    }}
                  >
                    <FileIcon size={13} />
                    Open {fileScope === "local" ? "settings.local.json" : "settings.json"}
                  </button>
                )}
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setConfirm({
                      title: `Restore ${SETTINGS_SECTION_LABELS[tab]} defaults?`,
                      detail: `Every setting in ${SETTINGS_SECTION_LABELS[tab]} goes back to its default and is removed from your user settings file.${projectConfig ? " Values this project's files set still apply in it." : ""} Other sections, and any saved tokens, are left alone.`,
                      confirmLabel: "Restore defaults",
                      danger: true,
                      onConfirm: () => void resetSection(tab),
                    })
                  }
                >
                  <UndoIcon size={13} />
                  Restore defaults
                </button>
              </div>
              )}
            </div>
            {canWriteFiles && projectConfig && sectionTakesProjectValues(tab) && (
              <SaveToControl
                value={target}
                projectName={project?.name}
                onChange={(scope) => setSaveTo({ projectId: projectConfig.projectId, scope })}
              />
            )}
            {error && <div className="notice settings-error" role="alert">{error}</div>}
            {tab === "general" && (
              <div className="appearance-page">
                <NotificationsCard settings={settings} onPatch={(next) => void patch(next)} />
                <ChatCard settings={settings} onPatch={(next) => void patch(next)} />
                <ConversationsCard settings={settings} onPatch={(next) => void patch(next)} />
                <ConfirmationsCard settings={settings} onPatch={(next) => void patch(next)} />
                <DesktopCard settings={settings} onPatch={(next) => void patch(next)} />
                <SavedPromptsSettings settings={settings} onPatch={(next) => void patch(next)} />
                <TagsSettings />
                <AnalyticsSettings settings={settings} patch={patch} />
              </div>
            )}

            {tab === "appearance" && (
              <AppearanceSettings settings={settings} onPatch={(next) => void patch(next)} />
            )}
            {tab === "appearance" && (
              <div className="appearance-page">
                <StatusLineSettings />
              </div>
            )}
            {tab === "automations" && (
              <div className="appearance-page">
                <AutomationsSettings />
              </div>
            )}
            {tab === "plugins" && (
              <div className="appearance-page">
                <PluginsPanel />
              </div>
            )}

            {tab === "agents" && (
              <div className="appearance-page">
                <NewConversationsCard
                  settings={settings}
                  agents={agents}
                  onPatch={(next) => void patch(next)}
                  routeRow={<RuntimeModeRow settings={settings} onPatch={patch} />}
                />
                <RepliesCard settings={settings} onPatch={(next) => void patch(next)} />
                <PlanModeCard settings={settings} harnesses={harnessList ?? []} editable={api.isDesktop !== false} onPatch={(next) => void patch(next)} />
                <ProfilesCard />
                <ResponseStyleCard />
                <PermissionRulesCard />
                <HarnessProvidersCard />
              </div>
            )}

            {tab === "tools" && (
              <div className="appearance-page">
                <McpServersSettings />
              </div>
            )}

            {tab === "sourceControl" && (
              <div className="appearance-page">
                <SourceControlTools />
                <WorktreeStorage settings={settings} chooseFolder={() => api.pickDirectory()} save={updateSettings} editable={api.isDesktop} />
                <GitCard settings={settings} onPatch={(next) => void patch(next)} />
              </div>
            )}

            {tab === "skills" && (
              <div className="appearance-page">
                <CommandsCard />
                <SkillCatalogCard settings={settings} onPatch={(next) => void patch(next)} />
              </div>
            )}

            {tab === "gateway" && (
              <>
                <div className="card">
                  <h3>Gateway</h3>
                  <p className="muted">
                    Optional. Connect an OpenClaw Gateway for its agents, plugins and messaging channels.
                    Agents on this computer do not need one.
                  </p>
                  <SettingRow label="Gateway URL" setting="gatewayUrl" hint="The address the Gateway listens on.">
                    <input
                      type="text"
                      className="field-select"
                      aria-label="Gateway URL"
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
                  </SettingRow>
                  <SettingRow label="Gateway token" hint={tokenSaved ? "A token is saved in the Keychain." : "Optional when the Gateway runs on this computer."}>
                    <div className="setting-inline settings-inline-tight">
                      <input
                        type="password"
                        className="field-select"
                        aria-label="Gateway token"
                        value={token}
                        placeholder={tokenSaved ? "Stored in Keychain" : "Optional"}
                        autoComplete="off"
                        onChange={(event) => setToken(event.target.value)}
                      />
                      {tokenSaved && (
                        <button className="ghost" type="button" onClick={() => void patch({ gatewayToken: "" })}>
                          Clear
                        </button>
                      )}
                    </div>
                  </SettingRow>
                  <SettingRow
                    label="Status"
                    hint={connected ? `Connected to ${status?.gatewayHost}:${status?.gatewayPort}.` : `${status?.state ?? "Disconnected"}.`}
                  >
                    <div className="setting-inline settings-inline-tight">
                      <button className="ghost" type="button" disabled={busy || !connected} onClick={() => void disconnect()}>
                        Disconnect
                      </button>
                      <button className="send" type="button" disabled={busy} onClick={() => void connect()}>
                        {busy ? "Connecting…" : connected ? "Reconnect" : "Connect"}
                      </button>
                    </div>
                  </SettingRow>
                  <AdvancedRows>
                    <SettingRow
                      label="Connection details"
                      hint={`Gateway ${status?.openclawVersion ?? "version unknown"}, protocol ${status?.protocol ?? 4}. Capsule signs in with a device identity.`}
                    >
                      <span className="faint">
                        {status?.agentCount ?? 0} agents · {status?.sessionCount ?? 0} sessions · {status?.activeRunCount ?? 0} running
                      </span>
                    </SettingRow>
                    {(harnessList ?? [])
                      .filter((harness) => isFeaturedHarness(harness) || Boolean(harness.binaryPath) || harness.readiness === "dedicated" || harness.readiness === "running")
                      .map((harness) => (
                        <SettingRow key={harness.id} label={harness.name} hint={harness.detail}>
                          <span className={`readiness ${harness.readiness}`}>{harness.readiness.replaceAll("_", " ")}</span>
                        </SettingRow>
                      ))}
                    <GatewayApiKeysRow />
                  </AdvancedRows>
                </div>
                <RemoteAccessSettings settings={settings} patch={patch} />
              </>
            )}

            {tab === "projects" && (
              <>
              <div className="card">
                <h3>Inbox</h3>
                <SettingRow
                  label="Inbox folder" setting="projectlessFolder"
                  hint="Where conversations outside a project run. Each one gets a dated subfolder."
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
                        Show in folder
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
              </div>
              <div className="card">
                <h3>Your projects</h3>
                <p className="muted">
                  Deleting a project removes its conversations from Capsule, not its folder.
                  Extra folders stay readable, while Git and new conversations use the first.
                </p>
                {projects.map((item) => (
                  <div className="row project-settings-row" key={item.id} style={{ marginBottom: 8 }}>
                    <span className="project-settings-icon">
                      {item.iconDataUrl ? <img src={item.iconDataUrl} alt="" /> : item.name.slice(0, 1).toUpperCase()}
                    </span>
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
                    {item.name !== "Inbox" ? (
                      <>
                        <button
                          className="ghost"
                          type="button"
                          onClick={() => {
                            void (async () => {
                              const paths = (await api.pickFiles()) as string[] | undefined;
                              const iconPath = paths?.[0];
                              if (!iconPath) return;
                              await api.updateProject(item.id, { iconPath });
                              await refresh();
                            })();
                          }}
                        >
                          Choose icon
                        </button>
                        {item.iconPath ? (
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => {
                              void api.updateProject(item.id, { iconPath: null }).then(() => refresh());
                            }}
                          >
                            Automatic
                          </button>
                        ) : null}
                      </>
                    ) : null}
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
                {project && (
                  <SettingRow
                    label={`${project.name} folder`}
                    hint={formatProjectRoot(project.workingDirectory, { home: window.capsule.homeDir, fallback: "No folder yet." })}
                  >
                    <button className="ghost" type="button" onClick={() => void pickProjectDirectory()}>
                      Choose folder
                    </button>
                  </SettingRow>
                )}
              </div>
              </>
            )}
            {tab === "projects" && <OpenInSettings />}

            {tab === "shortcuts" && (
              <KeybindingsSettings />
            )}

            {tab === "diagnostics" && (
              <div className="appearance-page">
                <CustomizationDoctor />
                <ProcessMonitor />
                <PerformanceDiagnostics />
              <div className="card">
                <h3>Subsystems</h3>
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
    </SettingSourceContext.Provider>
  );
}
