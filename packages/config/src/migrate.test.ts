import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { DEFAULT_CAPSULE_SETTINGS, SETTINGS_SCHEMA_URL } from "@capsule/shared";
import { migrateDatabaseSettings } from "./migrate.js";
import { ConfigPaths } from "./paths.js";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function fixture(stored: Record<string, unknown> | undefined) {
  const home = mkdtempSync(path.join(tmpdir(), "capsule-migrate-"));
  homes.push(home);
  const paths = new ConfigPaths(path.join(home, ".capsule"));
  let migratedAt: string | undefined;
  const run = () => migrateDatabaseSettings({
    paths,
    stored: stored ? JSON.stringify(stored) : undefined,
    defaults: DEFAULT_CAPSULE_SETTINGS,
    record: { read: () => migratedAt, write: (at) => { migratedAt = at; } },
    now: () => new Date("2026-11-14T00:00:00Z"),
  });
  return { paths, run, migratedAt: () => migratedAt };
}

it("exports only the choices that differ from the defaults, and never a secret", () => {
  const { paths, run, migratedAt } = fixture({
    ...DEFAULT_CAPSULE_SETTINGS,
    gatewayToken: "fixture-secret",
    skillsShToken: "fixture-catalog",
    transcriptSize: "l",
    branchPrefix: "team",
  });
  expect(run()).toEqual({ status: "migrated", keys: ["transcriptSize", "branchPrefix"], keybindings: 0 });
  const text = readFileSync(paths.userSettings, "utf8");
  expect(JSON.parse(text)).toEqual({ $schema: SETTINGS_SCHEMA_URL, transcriptSize: "l", branchPrefix: "team" });
  expect(text).not.toContain("fixture-secret");
  expect(text).not.toContain("fixture-catalog");
  expect(migratedAt()).toBe("2026-11-14T00:00:00.000Z");
});

it("moves key bindings to their own file with the new chord names", () => {
  const { paths, run } = fixture({ keybindings: { "search.focus": "meta+shift+f", "palette.open": "ctrl+alt+p" } });
  expect(run()).toMatchObject({ status: "migrated", keybindings: 2 });
  expect(JSON.parse(readFileSync(paths.keybindings, "utf8"))).toEqual([
    { context: "global", bindings: { "cmd+shift+f": "search.focus", "ctrl+alt+p": "palette.open" } },
  ]);
  expect(JSON.parse(readFileSync(paths.userSettings, "utf8"))).not.toHaveProperty("keybindings");
});

it("runs once", () => {
  const { paths, run } = fixture({ transcriptSize: "l" });
  run();
  writeFileSync(paths.userSettings, "{}\n");
  expect(run()).toEqual({ status: "already-migrated" });
  expect(readFileSync(paths.userSettings, "utf8")).toBe("{}\n");
});

it("never replaces a settings file that already exists", () => {
  const { paths, run, migratedAt } = fixture({ transcriptSize: "l" });
  mkdirSync(paths.userDir, { recursive: true });
  writeFileSync(paths.userSettings, '{ "diffLayout": "unified" }\n');
  expect(run()).toEqual({ status: "file-exists" });
  expect(readFileSync(paths.userSettings, "utf8")).toBe('{ "diffLayout": "unified" }\n');
  expect(migratedAt()).toBeDefined();
});

it("starts a fresh profile with an empty file that names its schema", () => {
  const { paths, run } = fixture(undefined);
  expect(run()).toEqual({ status: "migrated", keys: [], keybindings: 0 });
  expect(JSON.parse(readFileSync(paths.userSettings, "utf8"))).toEqual({ $schema: SETTINGS_SCHEMA_URL });
  expect(existsSync(paths.keybindings)).toBe(false);
});
