import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "./service.js";
import { createTrustStore } from "./trust.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture(options: { watch?: boolean; safeMode?: boolean } = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "capsule-commands-"));
  const userDir = path.join(home, ".capsule");
  const project = path.join(home, "project");
  mkdirSync(project, { recursive: true });
  let trusted: string | undefined;
  const trust = createTrustStore({ read: () => trusted, write: (value) => { trusted = value; } });
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const open = () => {
    const service = new ConfigService({
      userDir,
      homeDir: home,
      lastGoodDir: path.join(home, "last-good"),
      trust,
      safeMode: options.safeMode,
      watch: options.watch ? { debounceMs: 40, pollMs: 25 } : false,
    });
    service.load();
    cleanups.push(() => service.close());
    return service;
  };
  return {
    home,
    project,
    open,
    write,
    user: (name: string, text: string) => write(path.join(userDir, "commands", name), text),
    projectCommand: (name: string, text: string) => write(path.join(project, ".capsule", "commands", name), text),
    enable: (sources: Record<string, boolean>) => write(path.join(userDir, "settings.json"), JSON.stringify({ commandSources: sources })),
  };
}

const names = (service: ConfigService, root?: string) =>
  service.commands(root).commands.map((entry) => [entry.command.name, entry.source, entry.scope]);

describe("command discovery", () => {
  it("lists the project's commands over the user's, and names folders as namespaces", () => {
    const f = fixture();
    f.user("review.md", "---\ndescription: Mine\n---\nUser review");
    f.user("git/commit.md", "Commit");
    f.projectCommand("review.md", "---\ndescription: Team\n---\nTeam review");
    const service = f.open();

    expect(names(service)).toEqual([["git:commit", "user", "user"], ["review", "user", "user"]]);
    const catalog = service.commands(f.project);
    expect(names(service, f.project)).toEqual([["git:commit", "user", "user"], ["review", "project", "project"]]);
    expect(catalog.commands.find((entry) => entry.command.name === "review")?.command.description).toBe("Team");
    expect(catalog.problems).toEqual([
      expect.objectContaining({ severity: "warning", path: path.join(f.home, ".capsule", "commands", "review.md"), message: expect.stringMatching(/takes precedence/) }),
    ]);
  });

  it("reads other tools' folders only once the user turns them on", () => {
    const f = fixture();
    f.write(path.join(f.home, ".claude", "commands", "Fix-Issue.md"), "---\nallowed-tools: Bash\n---\nFix $ARGUMENTS");
    f.write(path.join(f.project, ".claude", "commands", "deploy.md"), "Deploy");
    f.write(path.join(f.home, ".codex", "prompts", "explain.md"), "Explain $1");
    f.user("explain.md", "Mine wins");
    const off = f.open();
    expect(names(off, f.project)).toEqual([["explain", "user", "user"]]);

    f.enable({ "claude-commands": true, "codex-prompts": true });
    const on = f.open();
    const catalog = on.commands(f.project);
    expect(names(on, f.project)).toEqual([
      ["deploy", "claude", "project"],
      ["explain", "user", "user"],
      ["fix-issue", "claude", "user"],
    ]);
    expect(catalog.problems.map((problem) => problem.message)).toEqual([expect.stringMatching(/^\/explain is also defined in/)]);
  });

  it("keeps a file with a frontmatter mistake and reports it, and refuses a name nobody can type", () => {
    const f = fixture();
    f.user("ok.md", "---\nsend: later\n---\nBody");
    f.user("Bad Name.md", "Body");
    const catalog = f.open().commands();
    expect(catalog.commands.map((entry) => entry.command.name)).toEqual(["ok"]);
    expect(catalog.problems).toEqual([
      expect.objectContaining({ severity: "error", message: expect.stringMatching(/not a valid command name/) }),
      expect.objectContaining({ severity: "warning", message: "line 2: send must be auto or review." }),
    ]);
  });

  it("puts command problems and a project's waiting shell in the doctor", () => {
    const f = fixture();
    f.user("broken.md", "---\nmode: yolo\n---\nBody");
    f.projectCommand("pr.md", "Diff: !`git diff $0`");
    const service = f.open();
    const diagnostics = service.diagnostics(f.project);
    expect(diagnostics.problems.map((problem) => problem.message)).toContain("line 2: mode must be one of chat, agent, plan, code, research, browser, automation.");
    expect(diagnostics.trust?.pending).toEqual([
      { kind: "command-shell", detail: "/pr: git diff $0", path: path.join(f.project, ".capsule", "commands", "pr.md") },
    ]);
    service.trust(f.project, true);
    expect(service.diagnostics(f.project).trust?.pending).toEqual([]);
  });

  it("loads no command in safe mode", () => {
    const f = fixture({ safeMode: true });
    f.user("review.md", "Body");
    expect(f.open().commands()).toEqual({ commands: [], problems: [] });
  });

  it("tells listeners when a command file changes", async () => {
    const f = fixture({ watch: true });
    f.user("review.md", "One");
    const service = f.open();
    service.commands(f.project);
    const changed = vi.fn();
    service.onChange(changed);
    f.projectCommand("ship.md", "Ship it");
    await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 15_000 });
    expect(names(service, f.project)).toContainEqual(["ship", "project", "project"]);
  });
});
