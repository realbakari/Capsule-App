import { describe, expect, it } from "vitest";
import { DEFAULT_CAPSULE_SETTINGS, type ConfigDiagnostics, type ConfigSnapshot, type ConfigSourceReport } from "@capsule/shared";
import {
  modifiedKeys,
  pendingTrust,
  projectSettingsFor,
  routeSettingsPatch,
  sectionTakesProjectValues,
  settingsFileTarget,
  settingsLayerView,
  asSentence,
  shortConfigPath,
  sourceChip,
  sourceFileTarget,
  sourcesByPrecedence,
  trackBrokenFiles,
  writeScope,
} from "./config-view.js";

const USER_FILE = "/home/ana/.capsule/settings.json";
const PROJECT_FILE = "/work/app/.capsule/settings.json";
const LOCAL_FILE = "/work/app/.capsule/settings.local.json";

function snapshot(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    safeMode: false,
    userDir: "/home/ana/.capsule",
    settings: { ...DEFAULT_CAPSULE_SETTINGS, transcriptWidth: "wide" },
    provenance: { transcriptWidth: { scope: "user", path: USER_FILE } },
    project: {
      projectId: "proj_app",
      root: "/work/app",
      trusted: false,
      settings: { ...DEFAULT_CAPSULE_SETTINGS, transcriptWidth: "wide", defaultPermission: "strict", diffLayout: "unified" },
      provenance: {
        transcriptWidth: { scope: "user", path: USER_FILE },
        defaultPermission: { scope: "project", path: PROJECT_FILE },
        diffLayout: { scope: "local", path: LOCAL_FILE },
      },
      files: { project: true, local: true },
    },
    problemCount: 0,
    themes: { light: "capsule-light", dark: "capsule-dark", themes: [], backdrop: {} },
    keybindings: [],
    ...overrides,
  };
}

const NO_RULES = { permissions: { allow: [], ask: [], deny: [] }, hooks: {}, hooksDisabled: false };

describe("provenance chips", () => {
  it("names the file that set a value and leaves defaults unmarked", () => {
    expect(sourceChip({ scope: "user", path: USER_FILE })).toEqual({ label: "user file", layer: "user", path: USER_FILE });
    expect(sourceChip({ scope: "project", path: PROJECT_FILE })?.label).toBe("project");
    expect(sourceChip({ scope: "local", path: LOCAL_FILE })?.label).toBe("project (local)");
    expect(sourceChip({ scope: "legacy", path: "/work/app/capsule.json" })).toMatchObject({ label: "capsule.json", layer: "legacy" });
    expect(sourceChip({ scope: "default" })).toBeUndefined();
    expect(sourceChip(undefined)).toBeUndefined();
  });

  it("opens a project file for its project and the user file without one", () => {
    expect(settingsFileTarget("local", "proj_app")).toEqual({ kind: "settings", scope: "local", projectId: "proj_app" });
    expect(settingsFileTarget("user", "proj_app")).toEqual({ kind: "settings", scope: "user" });
    expect(settingsFileTarget("project")).toEqual({ kind: "settings", scope: "user" });
  });
});

describe("opening a listed file", () => {
  it("opens settings and key bindings through main, and anything else by its path", () => {
    expect(sourceFileTarget({ kind: "settings", scope: "project" }, "proj_app")).toEqual({ kind: "settings", scope: "project", projectId: "proj_app" });
    expect(sourceFileTarget({ kind: "keybindings", scope: "user" })).toEqual({ kind: "keybindings" });
    expect(sourceFileTarget({ kind: "settings", scope: "legacy" }, "proj_app")).toBeUndefined();
    expect(sourceFileTarget({ kind: "settings", scope: "local" })).toBeUndefined();
  });
});

describe("saving to a layer", () => {
  it("sends keys a project may set to the chosen project file and everything else to the user save", () => {
    const routed = routeSettingsPatch({ diffLayout: "unified", transcriptWidth: "narrow", gatewayToken: "secret" }, "project");
    expect(routed.layer).toEqual([{ key: "diffLayout", value: "unified" }]);
    expect(routed.user).toEqual({ transcriptWidth: "narrow", gatewayToken: "secret" });
  });

  it("keeps every write in the user file when saving to You", () => {
    expect(routeSettingsPatch({ diffLayout: "split", defaultPermission: "strict" }, "user")).toEqual({
      user: { diffLayout: "split", defaultPermission: "strict" },
      layer: [],
    });
  });

  it("follows the key registry's scope rather than a list of its own", () => {
    expect(writeScope("defaultPermission", "local")).toBe("local");
    expect(writeScope("remoteAccess", "local")).toBe("user");
    expect(writeScope("notASetting", "project")).toBe("user");
  });

  it("offers Save to only in sections a project file can change", () => {
    expect(sectionTakesProjectValues("sourceControl")).toBe(true);
    expect(sectionTakesProjectValues("agents")).toBe(true);
    expect(sectionTakesProjectValues("general")).toBe(false);
    expect(sectionTakesProjectValues("about")).toBe(false);
  });
});

describe("what Settings shows", () => {
  const user = { ...DEFAULT_CAPSULE_SETTINGS, transcriptWidth: "wide" as const };

  it("shows your values for You and the project's merged values for a project layer", () => {
    expect(settingsLayerView(user, snapshot(), "user").settings.defaultPermission).toBe(DEFAULT_CAPSULE_SETTINGS.defaultPermission);
    const project = settingsLayerView(user, snapshot(), "project");
    expect(project.settings.defaultPermission).toBe("strict");
    expect(project.provenance.diffLayout?.scope).toBe("local");
  });

  it("falls back to your own layer when there is no project snapshot", () => {
    expect(settingsLayerView(user, snapshot({ project: undefined }), "local").target).toBe("user");
  });

  it("gives a new conversation the open project's settings, never another project's", () => {
    expect(projectSettingsFor(snapshot(), "proj_app")?.defaultPermission).toBe("strict");
    expect(projectSettingsFor(snapshot(), "proj_other")).toBeUndefined();
    expect(projectSettingsFor(snapshot(), undefined)).toBeUndefined();
  });

  it("counts as modified every key any file set", () => {
    expect([...modifiedKeys(snapshot())].sort()).toEqual(["defaultPermission", "diffLayout", "transcriptWidth"]);
    expect(modifiedKeys(undefined).size).toBe(0);
  });
});

describe("the doctor", () => {
  const source = (scope: ConfigSourceReport["scope"], kind: ConfigSourceReport["kind"] = "settings"): ConfigSourceReport =>
    ({ kind, scope, path: `/${kind}/${scope}`, state: "ok" });

  it("lists settings files strongest first, then the other files", () => {
    const ordered = sourcesByPrecedence([source("user"), source("user", "keybindings"), source("project"), source("local"), source("legacy")]);
    expect(ordered.map((item) => `${item.kind}:${item.scope}`)).toEqual([
      "settings:local", "settings:project", "settings:legacy", "settings:user", "keybindings:user",
    ]);
  });

  it("lists what waits for trust only for an untrusted project it describes", () => {
    const pending = [{ kind: "hook" as const, detail: "./scripts/check.sh", path: PROJECT_FILE }];
    const diagnostics = (root: string): ConfigDiagnostics => ({ safeMode: false, userDir: "/home/ana/.capsule", sources: [], problems: [], runs: [], ...NO_RULES, trust: { root, trusted: false, pending } });
    expect(pendingTrust(snapshot(), diagnostics("/work/app"))).toEqual(pending);
    expect(pendingTrust(snapshot(), diagnostics("/work/other"))).toEqual([]);
    const trusted = snapshot();
    trusted.project!.trusted = true;
    expect(pendingTrust(trusted, diagnostics("/work/app"))).toEqual([]);
  });
});

describe("announcing a broken file", () => {
  const diagnostics = (...sources: ConfigSourceReport[]): ConfigDiagnostics =>
    ({ safeMode: false, userDir: "/home/ana/.capsule", sources, problems: [], runs: [], ...NO_RULES });
  const broken = (line: number): ConfigSourceReport =>
    ({ kind: "settings", scope: "user", path: USER_FILE, state: "broken", error: { message: "Expected a comma", line, column: 3 }, usingLastGood: true });
  const fixed: ConfigSourceReport = { kind: "settings", scope: "user", path: USER_FILE, state: "ok" };

  it("announces each break once, and again only after the file parsed or broke elsewhere", () => {
    let seen = trackBrokenFiles(new Map(), diagnostics(broken(4)));
    expect(seen.announce).toHaveLength(1);
    seen = trackBrokenFiles(seen.announced, diagnostics(broken(4)));
    expect(seen.announce).toHaveLength(0);
    seen = trackBrokenFiles(seen.announced, diagnostics(broken(9)));
    expect(seen.announce.map((item) => item.error?.line)).toEqual([9]);
    seen = trackBrokenFiles(seen.announced, diagnostics(fixed));
    seen = trackBrokenFiles(seen.announced, diagnostics(broken(9)));
    expect(seen.announce).toHaveLength(1);
  });

  it("keeps a break announced while another project's diagnostics are shown", () => {
    const first = trackBrokenFiles(new Map(), diagnostics(broken(4)));
    const elsewhere = trackBrokenFiles(first.announced, diagnostics());
    expect(trackBrokenFiles(elsewhere.announced, diagnostics(broken(4))).announce).toHaveLength(0);
  });
});

describe("messages", () => {
  it("ends a parser message with one full stop", () => {
    expect(asSentence("Comma expected.")).toBe("Comma expected.");
    expect(asSentence("Comma expected ")).toBe("Comma expected.");
  });
});

describe("paths", () => {
  it("writes home as ~ and keeps the folders that tell two settings files apart", () => {
    expect(shortConfigPath(USER_FILE, "/home/ana")).toBe("~/.capsule/settings.json");
    expect(shortConfigPath("/Users/ana/code/team/app/.capsule/settings.json", "/home/ana")).toBe("…/app/.capsule/settings.json");
  });
});
