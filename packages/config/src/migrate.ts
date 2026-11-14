import { existsSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  normalizeCapsuleSettings,
  SETTINGS_SCHEMA,
  SETTINGS_SCHEMA_URL,
  type CapsuleSettings,
  type FileSettingKey,
} from "@capsule/shared";
import { writeJsonc } from "./jsonc.js";
import type { ConfigPaths } from "./paths.js";

/** A key binding file: chords mapped to command ids, per context. */
export type KeybindingsFile = Array<{ context: string; bindings: Record<string, string> }>;

export type MigrationResult =
  | { status: "already-migrated" }
  /** A settings file was already there, so the database row is not exported. */
  | { status: "file-exists" }
  | { status: "migrated"; keys: string[]; keybindings: number };

/**
 * The preferences in the database row that differ from the defaults, as a
 * settings file holds them. Secrets are not file keys and never appear, and
 * key bindings move to their own file.
 */
export function fileValuesFromStored(stored: string | undefined, defaults: CapsuleSettings): Partial<Record<FileSettingKey, unknown>> {
  const settings = normalizeCapsuleSettings({ ...defaults, ...parseRow(stored) });
  const values: Partial<Record<FileSettingKey, unknown>> = {};
  for (const key of Object.keys(SETTINGS_SCHEMA) as FileSettingKey[]) {
    if (key === "keybindings") continue;
    const value = settings[key];
    if (value !== undefined && !isDeepStrictEqual(value, defaults[key])) values[key] = value;
  }
  return values;
}

/** The old `commandId → "meta+shift+f"` map as a key binding file. */
export function keybindingsFromStored(stored: string | undefined): KeybindingsFile {
  const map = parseRow(stored).keybindings;
  if (typeof map !== "object" || map === null) return [];
  const bindings: Record<string, string> = {};
  for (const [command, chord] of Object.entries(map)) {
    if (typeof chord === "string" && chord.trim()) bindings[toChord(chord)] = command;
  }
  return Object.keys(bindings).length ? [{ context: "global", bindings }] : [];
}

/**
 * Export the database settings to the user file, once. Runs only while no
 * user file exists and no migration was recorded; the database row is left
 * as it was, as a backup.
 */
export function migrateDatabaseSettings(options: {
  paths: ConfigPaths;
  stored: string | undefined;
  defaults: CapsuleSettings;
  record: { read(): string | undefined; write(at: string): void };
  now?: () => Date;
}): MigrationResult {
  const { paths, stored, defaults, record } = options;
  if (record.read()) return { status: "already-migrated" };
  const now = (options.now ?? (() => new Date()))().toISOString();
  if (existsSync(paths.userSettings)) {
    record.write(now);
    return { status: "file-exists" };
  }
  const values = fileValuesFromStored(stored, defaults);
  const keybindings = keybindingsFromStored(stored);
  if (keybindings.length && !existsSync(paths.keybindings)) writeJsonc(paths.keybindings, JSON.stringify(keybindings, null, 2));
  writeJsonc(paths.userSettings, JSON.stringify({ $schema: SETTINGS_SCHEMA_URL, ...values }, null, 2));
  record.write(now);
  return { status: "migrated", keys: Object.keys(values), keybindings: Object.keys(keybindings[0]?.bindings ?? {}).length };
}

const MODIFIERS: Record<string, string> = { meta: "cmd", command: "cmd", control: "ctrl", option: "alt" };

function toChord(chord: string): string {
  return chord.split("+").map((part) => part.trim().toLowerCase()).map((part) => MODIFIERS[part] ?? part).join("+");
}

function parseRow(stored: string | undefined): Partial<CapsuleSettings> {
  if (!stored) return {};
  try {
    const parsed: unknown = JSON.parse(stored);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Partial<CapsuleSettings>) : {};
  } catch {
    return {};
  }
}
