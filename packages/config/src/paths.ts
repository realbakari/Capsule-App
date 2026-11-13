import path from "node:path";
import type { WritableScope } from "@capsule/shared";

export const PROJECT_CONFIG_DIR = ".capsule";
export const SETTINGS_FILE = "settings.json";
export const LOCAL_SETTINGS_FILE = "settings.local.json";
export const KEYBINDINGS_FILE = "keybindings.json";
export const LEGACY_PROJECT_FILE = "capsule.json";

/** Where every customization file lives, for one user folder. */
export class ConfigPaths {
  readonly userDir: string;

  constructor(userDir: string) {
    this.userDir = path.resolve(userDir);
  }

  get userSettings(): string {
    return path.join(this.userDir, SETTINGS_FILE);
  }

  get keybindings(): string {
    return path.join(this.userDir, KEYBINDINGS_FILE);
  }

  projectDir(root: string): string {
    return path.join(path.resolve(root), PROJECT_CONFIG_DIR);
  }

  legacyFile(root: string): string {
    return path.join(path.resolve(root), LEGACY_PROJECT_FILE);
  }

  settingsFile(scope: WritableScope, root?: string): string {
    if (scope === "user") return this.userSettings;
    if (!root) throw new Error("Open a project to change its settings files.");
    return path.join(this.projectDir(root), scope === "local" ? LOCAL_SETTINGS_FILE : SETTINGS_FILE);
  }
}
