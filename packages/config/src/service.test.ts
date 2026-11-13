import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CAPSULE_SETTINGS, EXTENDED_SCHEMA, type ExtendedConfigKey } from "@capsule/shared";
import { ConfigService, SAFE_MODE_WRITE_ERROR } from "./service.js";
import { createTrustStore } from "./trust.js";
import { hasTrustGate } from "./project-policy.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture(options: { safeMode?: boolean; watch?: boolean } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "capsule-config-"));
  const userDir = path.join(home, ".capsule");
  const project = path.join(home, "project");
  mkdirSync(project, { recursive: true });
  let trusted: string | undefined;
  const trust = createTrustStore({ read: () => trusted, write: (value) => { trusted = value; } });
  const open = () => {
    const service = new ConfigService({
      userDir,
      lastGoodDir: path.join(home, "last-good"),
      trust,
      safeMode: options.safeMode,
      watch: options.watch ? { debounceMs: 40, pollMs: 25 } : false,
    });
    service.load();
    cleanups.push(() => service.close());
    return service;
  };
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  return {
    home,
    userDir,
    project,
    open,
    write,
    userFile: path.join(userDir, "settings.json"),
    projectFile: path.join(project, ".capsule", "settings.json"),
    localFile: path.join(project, ".capsule", "settings.local.json"),
  };
}

describe("settings files", () => {
  it("keeps comments and formatting when Capsule writes a value", () => {
    const { open, write, userFile } = fixture();
    write(userFile, `{
  // Chosen for the big monitor.
  "transcriptWidth": "wide",
  /* Readable from the couch. */
  "reasoningSummary": "collapsed",
  "diffLayout": "unified",
}
`);
    const service = open();
    service.setValue({ key: "transcriptSize", value: "l", scope: "user" });
    service.setValue({ key: "diffLayout", value: "split", scope: "user" });
    const text = readFileSync(userFile, "utf8");
    expect(text).toContain("// Chosen for the big monitor.");
    expect(text).toContain("/* Readable from the couch. */");
    expect(text).toContain('"transcriptSize": "l"');
    // Split is the default, so the user file no longer holds a choice for it.
    expect(text).not.toContain("diffLayout");
    expect(service.settings()).toMatchObject({ transcriptWidth: "wide", reasoningSummary: "collapsed", transcriptSize: "l", diffLayout: "split" });
  });

  it("applies local over project over user over defaults, and says where each value came from", () => {
    const { open, write, userFile, projectFile, localFile, project } = fixture();
    write(userFile, JSON.stringify({ outputDetail: "verbose", diffLayout: "unified", transcriptSize: "l" }));
    write(projectFile, JSON.stringify({ outputDetail: "concise", diffLayout: "split" }));
    write(localFile, JSON.stringify({ outputDetail: "standard" }));
    const service = open();
    const config = service.forProject(project);
    expect(config.settings).toMatchObject({ outputDetail: "standard", diffLayout: "split", transcriptSize: "l", sandbox: DEFAULT_CAPSULE_SETTINGS.sandbox });
    expect(config.provenance.outputDetail).toEqual({ scope: "local", path: localFile });
    expect(config.provenance.diffLayout).toEqual({ scope: "project", path: projectFile });
    expect(config.provenance.transcriptSize).toEqual({ scope: "user", path: userFile });
    expect(config.provenance.sandbox).toBeUndefined();
    // The user-level view ignores project files.
    expect(service.settings().outputDetail).toBe("verbose");
    expect(config.files).toEqual({ project: true, local: true });
  });

  it("reads capsule.json's workspace mode below the project's settings file", () => {
    const { open, write, project, projectFile } = fixture();
    write(path.join(project, "capsule.json"), JSON.stringify({ defaultWorkspaceMode: "worktree" }));
    const service = open();
    expect(service.forProject(project).settings.defaultWorkspaceMode).toBe("worktree");
    expect(service.forProject(project).provenance.defaultWorkspaceMode?.scope).toBe("legacy");
    write(projectFile, JSON.stringify({ defaultWorkspaceMode: "local" }));
    service.reload();
    expect(service.forProject(project).settings.defaultWorkspaceMode).toBe("local");
  });

  it("merges maps by key and concatenates rule lists, keeping each entry's file", () => {
    const { open, write, userFile, projectFile, project } = fixture();
    write(userFile, JSON.stringify({
      permissions: { deny: ["edit(**/.env*)"], allow: ["execute(git status)"] },
      hooks: { TurnEnd: [{ hooks: [{ type: "command", command: "say done" }] }] },
      mcpServers: { docs: { url: "https://docs.example.test/mcp" }, shared: { url: "https://user.example.test" } },
    }));
    write(projectFile, JSON.stringify({
      permissions: { deny: ["execute(rm *)"], allow: ["execute(pnpm test *)"] },
      hooks: { TurnEnd: [{ hooks: [{ type: "command", command: "pnpm lint" }] }] },
      mcpServers: { shared: { url: "https://project.example.test" } },
    }));
    const service = open();
    service.trust(project, true);
    const extended = service.extended(project);
    expect(extended.permissions.deny).toEqual([
      { value: "edit(**/.env*)", source: { scope: "user", path: userFile } },
      { value: "execute(rm *)", source: { scope: "project", path: projectFile } },
    ]);
    expect(extended.permissions.allow.map((rule) => rule.value)).toEqual(["execute(git status)", "execute(pnpm test *)"]);
    expect(extended.hooks.TurnEnd?.map((group) => [group.source.scope, group.value.hooks[0]])).toEqual([
      ["user", { type: "command", command: "say done" }],
      ["project", { type: "command", command: "pnpm lint" }],
    ]);
    expect(Object.keys(extended.mcpServers)).toEqual(["docs", "shared"]);
    expect(extended.mcpServers.shared).toEqual({ value: { url: "https://project.example.test" }, source: { scope: "project", path: projectFile } });
  });

  it("ignores a user-only key in a project file and says so", () => {
    const { open, write, projectFile, project } = fixture();
    write(projectFile, JSON.stringify({ remoteAccess: "network", diffLayout: "unified", statusLine: { items: ["branch"], command: "./status.sh" } }));
    const service = open();
    const config = service.forProject(project);
    expect(config.settings.remoteAccess).toBe("off");
    expect(config.settings.diffLayout).toBe("unified");
    expect(config.extended.statusLine).toEqual({ items: ["branch"] });
    const problems = service.diagnostics(project).problems;
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", path: projectFile, key: "remoteAccess" }),
      expect.objectContaining({ severity: "warning", path: projectFile, key: "statusLine.command" }),
    ]));
  });

  it("holds a project's executable entries until the folder is trusted, and again after Revoke", () => {
    const { open, write, projectFile, project } = fixture();
    write(projectFile, JSON.stringify({
      diffLayout: "unified",
      disableAllHooks: true,
      permissions: { deny: ["execute(rm *)"], ask: ["fetch"], allow: ["execute(pnpm test *)"] },
      hooks: { PromptSubmit: [{ hooks: [{ type: "command", command: "./check-prompt.sh" }] }] },
      mcpServers: { tracker: { url: "https://tracker.example.test/mcp" } },
    }));
    const service = open();

    const untrusted = service.forProject(project);
    expect(untrusted.trusted).toBe(false);
    expect(untrusted.settings.diffLayout).toBe("unified");
    expect(untrusted.extended.disableAllHooks).toBe(true);
    expect(untrusted.extended.permissions.deny.map((rule) => rule.value)).toEqual(["execute(rm *)"]);
    expect(untrusted.extended.permissions.ask.map((rule) => rule.value)).toEqual(["fetch"]);
    expect(untrusted.extended.permissions.allow).toEqual([]);
    expect(untrusted.extended.hooks).toEqual({});
    expect(untrusted.extended.mcpServers).toEqual({});
    const diagnostics = service.diagnostics(project);
    expect(diagnostics.trust?.pending.map((item) => [item.kind, item.detail])).toEqual([
      ["permission-allow", "execute(pnpm test *)"],
      ["hook", "PromptSubmit: ./check-prompt.sh"],
      ["mcp-server", "tracker: https://tracker.example.test/mcp"],
    ]);
    expect(diagnostics.sources.find((source) => source.path === projectFile)?.state).toBe("untrusted");

    service.trust(project, true);
    const trusted = service.forProject(project);
    expect(trusted.extended.permissions.allow.map((rule) => rule.value)).toEqual(["execute(pnpm test *)"]);
    expect(trusted.extended.hooks.PromptSubmit).toHaveLength(1);
    expect(Object.keys(trusted.extended.mcpServers)).toEqual(["tracker"]);
    expect(service.diagnostics(project).trust).toMatchObject({ trusted: true, pending: [] });

    service.trust(project, false);
    expect(service.forProject(project).extended.hooks).toEqual({});
    expect(service.diagnostics(project).trust?.trusted).toBe(false);
  });

  it("keeps HTTP hooks and command MCP servers to the user file even in a trusted project", () => {
    const { open, write, projectFile, project } = fixture();
    write(projectFile, JSON.stringify({
      hooks: { TurnEnd: [{ hooks: [{ type: "http", url: "https://hooks.example.test" }, { type: "command", command: "make notify" }] }] },
      mcpServers: { local: { command: "node", args: ["server.js"] }, remote: { url: "https://mcp.example.test" } },
    }));
    const service = open();
    service.trust(project, true);
    const extended = service.extended(project);
    expect(extended.hooks.TurnEnd?.[0]?.value.hooks).toEqual([{ type: "command", command: "make notify" }]);
    expect(Object.keys(extended.mcpServers)).toEqual(["remote"]);
  });

  it("skips only the entries that fail validation", () => {
    const { open, write, userFile } = fixture();
    write(userFile, JSON.stringify({
      diffLayout: "sideways",
      transcriptSize: "l",
      permissions: { deny: ["execute(rm *)", "Not A Rule"] },
      appearanceLight: { accent: "#123456", contrast: 400 },
      madeUp: true,
    }));
    const service = open();
    expect(service.settings().diffLayout).toBe("split");
    expect(service.settings().transcriptSize).toBe("l");
    expect(service.settings().appearanceLight.accent).toBe("#123456");
    expect(service.extended().permissions.deny.map((rule) => rule.value)).toEqual(["execute(rm *)"]);
    const problems = service.diagnostics().problems.map((problem) => [problem.severity, problem.key]);
    expect(problems).toEqual(expect.arrayContaining([
      ["error", "diffLayout"],
      ["error", "permissions.deny[1]"],
      ["error", "appearanceLight.contrast"],
      ["warning", "madeUp"],
    ]));
  });

  it("serves a broken file's last good copy, across a restart, and points at the error", () => {
    const { open, write, userFile } = fixture();
    write(userFile, JSON.stringify({ transcriptWidth: "wide" }));
    open().close();
    write(userFile, `{
  "transcriptWidth": "wide",
  "diffLayout": "unified"
  "transcriptSize": "l"
}`);
    const service = open();
    expect(service.settings().transcriptWidth).toBe("wide");
    expect(service.settings().diffLayout).toBe("split");
    const source = service.diagnostics().sources.find((item) => item.path === userFile);
    expect(source).toMatchObject({ state: "broken", usingLastGood: true, error: { line: 4, column: 3 } });
    expect(service.diagnostics().problems).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "error", path: userFile })]));
    expect(() => service.setValue({ key: "transcriptSize", value: "s", scope: "user" })).toThrow(/line 4, column 3/);
  });

  it("removes a key on Reset and when the value equals the default, but a project file keeps a default", () => {
    const { open, write, userFile, projectFile, project } = fixture();
    write(userFile, JSON.stringify({ sandbox: "strict", diffLayout: "unified" }));
    const service = open();
    service.setValue({ key: "sandbox", scope: "user" });
    service.setValue({ key: "diffLayout", value: DEFAULT_CAPSULE_SETTINGS.diffLayout, scope: "user" });
    expect(JSON.parse(readFileSync(userFile, "utf8"))).not.toHaveProperty("sandbox");
    expect(JSON.parse(readFileSync(userFile, "utf8"))).not.toHaveProperty("diffLayout");
    expect(service.provenance().sandbox).toBeUndefined();

    service.setValue({ key: "diffLayout", value: DEFAULT_CAPSULE_SETTINGS.diffLayout, scope: "project", root: project });
    expect(JSON.parse(readFileSync(projectFile, "utf8"))).toMatchObject({ diffLayout: "split" });
  });

  it("refuses writes the registry does not allow", () => {
    const { open, project } = fixture();
    const service = open();
    expect(() => service.setValue({ key: "remoteAccess", value: "network", scope: "project", root: project })).toThrow(/user settings/);
    expect(() => service.setValue({ key: "diffLayout", value: "sideways", scope: "user" })).toThrow(/must be one of/);
    expect(() => service.setValue({ key: "gatewayToken", value: "secret", scope: "user" })).toThrow(/not a Capsule setting/);
  });

  it("keeps the personal file out of Git, once", () => {
    const { open, project } = fixture();
    execFileSync("git", ["init", "-q"], { cwd: project });
    const service = open();
    service.setValue({ key: "diffLayout", value: "unified", scope: "local", root: project });
    service.setValue({ key: "outputDetail", value: "verbose", scope: "local", root: project });
    const exclude = readFileSync(path.join(project, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((line) => line === ".capsule/settings.local.json")).toHaveLength(1);
    expect(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: project, encoding: "utf8" })).toBe("");
  });

  it("reads nothing and refuses every write in safe mode", () => {
    const { open, write, userFile, projectFile, project } = fixture({ safeMode: true });
    write(userFile, JSON.stringify({ transcriptSize: "l" }));
    write(projectFile, JSON.stringify({ diffLayout: "unified" }));
    const service = open();
    expect(service.settings()).toEqual(DEFAULT_CAPSULE_SETTINGS);
    expect(service.forProject(project).settings).toEqual(DEFAULT_CAPSULE_SETTINGS);
    const diagnostics = service.diagnostics(project);
    expect(diagnostics.safeMode).toBe(true);
    expect(diagnostics.sources.length).toBeGreaterThan(0);
    expect(diagnostics.sources.every((source) => source.state === "skipped")).toBe(true);
    expect(() => service.setValue({ key: "transcriptSize", value: "s", scope: "user" })).toThrow(SAFE_MODE_WRITE_ERROR);
  });

  it("reports a burst of edits once and notices a .capsule folder created later", async () => {
    const { open, write, userFile, projectFile, project } = fixture({ watch: true });
    const service = open();
    service.forProject(project);
    const changed = vi.fn();
    service.onChange(changed);

    for (const size of ["s", "m", "l"]) write(userFile, JSON.stringify({ transcriptSize: size }));
    await vi.waitFor(() => expect(service.settings().transcriptSize).toBe("l"), { timeout: 15_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(changed).toHaveBeenCalledTimes(1);

    write(projectFile, JSON.stringify({ diffLayout: "unified" }));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2), { timeout: 15_000 });
    expect(service.forProject(project).settings.diffLayout).toBe("unified");
  }, 40_000);

  it("does not report its own writes as changes", async () => {
    const { open } = fixture({ watch: true });
    const service = open();
    const changed = vi.fn();
    service.onChange(changed);
    service.setValue({ key: "transcriptSize", value: "l", scope: "user" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(changed).not.toHaveBeenCalled();
    expect(service.settings().transcriptSize).toBe("l");
  });

  it("creates a missing file from a template with its schema", () => {
    const { open, userDir, project } = fixture();
    const service = open();
    const file = service.ensureFile({ kind: "settings", scope: "project" }, project);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveProperty("$schema");
    expect(service.ensureFile({ kind: "folder", folder: "commands", scope: "user" })).toBe(path.join(userDir, "commands"));
  });

  it("lists resource files from the user folder and the project", () => {
    const { open, write, userDir, project } = fixture();
    write(path.join(userDir, "commands", "review.md"), "Review the diff.");
    write(path.join(project, ".capsule", "commands", "git", "commit.md"), "Commit.");
    write(path.join(project, ".capsule", "commands", "notes.txt"), "not a command");
    const service = open();
    expect(service.resources("commands", project).map((file) => [file.scope, file.name, file.text])).toEqual([
      ["user", "review", "Review the diff."],
      ["project", "git/commit", "Commit."],
    ]);
  });
});

describe("key registry", () => {
  it("gives every key that waits for trust a rule for what waits", () => {
    const gated = (Object.keys(EXTENDED_SCHEMA) as ExtendedConfigKey[]).filter((key) => EXTENDED_SCHEMA[key].needsTrust);
    expect(gated.length).toBeGreaterThan(0);
    for (const key of gated) expect(hasTrustGate(key)).toBe(true);
  });
});
