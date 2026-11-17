import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeProjectSlug } from "./history-parsers.js";
import { recentSessionSightings, repositoryRoot, suggestProjects, type SessionSighting } from "./project-suggestions.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-17T12:00:00Z");

describe("suggestProjects", () => {
  const sighting = (cwd: string, daysAgo: number, agent: SessionSighting["agent"] = "claude"): SessionSighting => ({ agent, cwd, at: NOW - daysAgo * DAY });
  const rules = {
    known: ["/work/already"],
    excluded: ["/tmp", "/profile"],
    home: "/home/dev",
    rootOf: (cwd: string) => (cwd.startsWith("/work/app") ? "/work/app" : cwd),
    exists: (folder: string) => folder !== "/work/deleted",
  };

  it("groups sessions by repository, keeps the busy ones, and lists the busiest first", () => {
    const sightings = [
      sighting("/work/app", 1), sighting("/work/app/packages/ui", 2), sighting("/work/app", 3, "codex"),
      sighting("/work/site", 1), sighting("/work/site", 2), sighting("/work/site", 3), sighting("/work/site", 4),
      sighting("/work/once", 1), sighting("/work/once", 2),
    ];
    expect(suggestProjects(sightings, rules)).toEqual([
      { path: "/work/site", name: "site", sessions: 4, agents: ["claude"], lastActivity: new Date(NOW - DAY).toISOString() },
      { path: "/work/app", name: "app", sessions: 3, agents: ["claude", "codex"], lastActivity: new Date(NOW - DAY).toISOString() },
    ]);
  });

  it("never suggests a project that exists, home, a temporary folder, Capsule's own data, or a folder that is gone", () => {
    const busy = (cwd: string) => [sighting(cwd, 1), sighting(cwd, 2), sighting(cwd, 3)];
    expect(suggestProjects([
      ...busy("/work/already"), ...busy("/work/already/sub"), ...busy("/home/dev"), ...busy("/tmp/scratch"),
      ...busy("/profile/worktrees/t1"), ...busy("/work/deleted"), ...busy("/"),
    ], rules)).toEqual([]);
  });

  it("allows folders under home and next to a known project", () => {
    const busy = (cwd: string) => [sighting(cwd, 1), sighting(cwd, 2), sighting(cwd, 3)];
    expect(suggestProjects([...busy("/home/dev/code/tool"), ...busy("/work/already-two")], rules).map((item) => item.path))
      .toEqual(["/home/dev/code/tool", "/work/already-two"]);
  });
});

describe("reading the agents' histories", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(path.join(os.tmpdir(), "capsule-suggest-")); });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function file(at: string, content: string, daysAgo: number) {
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, content);
    const time = (NOW - daysAgo * DAY) / 1000;
    utimesSync(at, time, time);
  }

  it("finds each session's folder from its first lines, counting only recent sessions", async () => {
    const repo = path.join(home, "code", "app");
    const claudeDir = path.join(home, ".claude", "projects", claudeProjectSlug(repo));
    file(path.join(claudeDir, "a.jsonl"), `{"type":"summary"}\n{"cwd":${JSON.stringify(repo)},"type":"user"}\n`, 1);
    file(path.join(claudeDir, "b.jsonl"), `{"type":"summary"}\n`, 5);
    file(path.join(claudeDir, "old.jsonl"), `{"cwd":${JSON.stringify(repo)}}\n`, 90);
    const day = new Date(NOW - 2 * DAY);
    const codexDir = path.join(home, ".codex", "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
    file(path.join(codexDir, "rollout-1.jsonl"), `{"type":"session_meta","payload":{"id":"x","cwd":${JSON.stringify(repo)}}}\n`, 2);

    const sightings = await recentSessionSightings({ HOME: home }, NOW - 30 * DAY, NOW);
    expect(sightings.map((item) => [item.agent, item.cwd]).sort()).toEqual([["claude", repo], ["claude", repo], ["codex", repo]]);
  });

  it("files a linked worktree under the repository it came from", () => {
    const main = path.join(home, "repo");
    const worktree = path.join(home, "wt", "feature");
    mkdirSync(path.join(main, ".git", "worktrees", "feature"), { recursive: true });
    mkdirSync(path.join(worktree, "src"), { recursive: true });
    writeFileSync(path.join(worktree, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "feature")}\n`);
    expect(repositoryRoot(path.join(main), home)).toBe(main);
    expect(repositoryRoot(path.join(worktree, "src"), home)).toBe(main);
    expect(repositoryRoot(path.join(home, "loose"), home)).toBe(path.join(home, "loose"));
  });
});
