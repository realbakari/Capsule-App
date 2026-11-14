import type { ConfigSnapshot, ThemeSelection } from "@capsule/shared";
import { settingsFileTarget } from "../../lib/config-view";
import { formatUserError } from "../../lib/errors";
import type { SearchDialogItem } from "../shell/SearchDialog";
import { ChartIcon, FileIcon, FolderIcon, GridIcon, HistoryIcon, KeyboardIcon, RefreshIcon, ShieldIcon, SunIcon } from "../shell/icons";

/** `theme` with the backdrop turned off, whatever the chosen theme draws. Shared with the clear-backdrop key action. */
export function clearedBackdrop(selection: ThemeSelection | undefined): ThemeSelection {
  return { ...selection, backdrop: { scene: "none" } };
}

/**
 * The settings files from the command palette. Each reaches the host, so a
 * paired device sees them disabled, except the way to the doctor.
 */
export function customizationCommands(input: {
  api: typeof window.capsule;
  config?: ConfigSnapshot;
  showProblems: () => void;
  onError: (message: string) => void;
}): SearchDialogItem[] {
  const { api, config, showProblems, onError } = input;
  const run = (action: () => Promise<unknown>) => () => { void action().catch((error: unknown) => onError(formatUserError(error))); };
  const desktopOnly = api.isDesktop === true ? undefined : "Available in the desktop app.";
  const project = config?.project;
  const needsProject = desktopOnly ?? (project ? undefined : "Open a project with a folder first.");
  const group = "Customization";
  return [
    { id: "config-open-user", label: "Open user settings", group, icon: <FileIcon size={15} />, disabledReason: desktopOnly,
      onSelect: run(() => api.configOpenFile(settingsFileTarget("user"))) },
    { id: "config-open-project", label: "Open project settings", group, icon: <FileIcon size={15} />, disabledReason: needsProject,
      onSelect: run(() => api.configOpenFile(settingsFileTarget("project", project?.projectId))) },
    { id: "config-open-local", label: "Open project local settings", group, icon: <FileIcon size={15} />, disabledReason: needsProject,
      onSelect: run(() => api.configOpenFile(settingsFileTarget("local", project?.projectId))) },
    { id: "config-open-hooks", label: "Open hooks settings", detail: "Hooks live in your user settings file", group, icon: <FileIcon size={15} />, disabledReason: desktopOnly,
      onSelect: run(() => api.configOpenFile(settingsFileTarget("user"))) },
    { id: "config-open-keybindings", label: "Open keybindings file", group, icon: <KeyboardIcon size={15} />, disabledReason: desktopOnly,
      onSelect: run(() => api.configOpenFile({ kind: "keybindings" })) },
    { id: "theme-import", label: "Import theme from a file", group, icon: <SunIcon size={15} />, disabledReason: desktopOnly,
      onSelect: run(() => api.themesImport({ from: "file" })) },
    { id: "theme-open-folder", label: "Open themes folder", group, icon: <FolderIcon size={15} />, disabledReason: desktopOnly,
      onSelect: run(() => api.configOpenFile({ kind: "folder", folder: "themes", scope: "user" })) },
    { id: "backdrop-clear", label: "Clear backdrop", group, icon: <GridIcon size={15} />,
      disabledReason: desktopOnly ?? (config?.themes.backdrop.light || config?.themes.backdrop.dark ? undefined : "No backdrop is drawn."),
      onSelect: run(() => api.configSetValue({ key: "theme", value: clearedBackdrop(config?.themes.selection), scope: "user" })) },
    { id: "config-reload", label: "Reload customizations", group, icon: <RefreshIcon size={15} />,
      disabledReason: desktopOnly ?? (config?.safeMode ? "Safe mode reads no settings file." : undefined),
      onSelect: run(() => api.configReload(project?.projectId)) },
    { id: "config-trust", label: project?.trusted ? "Revoke trust for this project" : "Trust this project", group, icon: <ShieldIcon size={15} />,
      disabledReason: needsProject, onSelect: run(() => api.configTrust(project!.projectId, !project!.trusted)) },
    { id: "config-restart", label: config?.safeMode ? "Restart normally" : "Restart without customizations", group, icon: <RefreshIcon size={15} />,
      disabledReason: desktopOnly, onSelect: run(() => api.appRestart({ safeMode: !config?.safeMode })) },
    ...(config?.automations ?? []).map((automation) => ({
      id: `automation-run-${automation.key}`,
      label: `Run automation ${automation.name}`,
      detail: automation.missed ? `Missed ${automation.missed.count} while closed` : automation.scheduleText,
      group,
      icon: <HistoryIcon size={15} />,
      disabledReason: (api.isDesktop === true && !config?.safeMode ? undefined : "Available in the desktop app.") ?? (automation.running ? "It is still running." : automation.problem),
      onSelect: run(() => api.automationsRunNow({ key: automation.key, ...(project ? { projectId: project.projectId } : {}) })),
    })),
    { id: "config-problems", label: "Show customization problems", group, icon: <ChartIcon size={15} />,
      detail: config?.problemCount ? `${config.problemCount} ${config.problemCount === 1 ? "problem" : "problems"}` : undefined,
      onSelect: showProblems },
  ];
}
