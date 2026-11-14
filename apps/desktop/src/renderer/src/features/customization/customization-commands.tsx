import type { ConfigSnapshot } from "@capsule/shared";
import { settingsFileTarget } from "../../lib/config-view";
import { formatUserError } from "../../lib/errors";
import type { SearchDialogItem } from "../shell/SearchDialog";
import { ChartIcon, FileIcon, KeyboardIcon, RefreshIcon, ShieldIcon } from "../shell/icons";

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
    { id: "config-reload", label: "Reload customizations", group, icon: <RefreshIcon size={15} />,
      disabledReason: desktopOnly ?? (config?.safeMode ? "Safe mode reads no settings file." : undefined),
      onSelect: run(() => api.configReload(project?.projectId)) },
    { id: "config-trust", label: project?.trusted ? "Revoke trust for this project" : "Trust this project", group, icon: <ShieldIcon size={15} />,
      disabledReason: needsProject, onSelect: run(() => api.configTrust(project!.projectId, !project!.trusted)) },
    { id: "config-restart", label: config?.safeMode ? "Restart normally" : "Restart without customizations", group, icon: <RefreshIcon size={15} />,
      disabledReason: desktopOnly, onSelect: run(() => api.appRestart({ safeMode: !config?.safeMode })) },
    { id: "config-problems", label: "Show customization problems", group, icon: <ChartIcon size={15} />,
      detail: config?.problemCount ? `${config.problemCount} ${config.problemCount === 1 ? "problem" : "problems"}` : undefined,
      onSelect: showProblems },
  ];
}
