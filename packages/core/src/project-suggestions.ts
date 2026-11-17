import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { ImportAgentId, SuggestedProject } from "@capsule/shared";
import { HISTORY_SOURCES } from "./history-parsers.js";

/*
 * Folders worth offering as projects on first run, read from the session
 * histories Capsule already imports from. Everything here is local: file
 * names, modification times and the working folder each session recorded.
 * No prompt text is read.
 */

/** One session an agent's history recorded: where it ran and when it last changed. */
export interface SessionSighting {
  agent: ImportAgentId;
  cwd: string;
  at: number;
}

export const SUGGESTION_WINDOW_DAYS = 30;
export const SUGGESTION_MIN_SESSIONS = 3;
const MAX_SUGGESTIONS = 8;
const MAX_FILES = 600;
const HEADER_LINES = 40;

async function filesIn(dir: string): Promise<string[]> {
  return (await readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(dir, entry.name));
}

async function mtime(file: string): Promise<number> {
  return (await stat(file).catch(() => undefined))?.mtimeMs ?? 0;
}

/** The first `"cwd"` a session file records in its opening lines, without reading the rest. */
async function recordedCwd(file: string, pick: (line: Record<string, unknown>) => unknown): Promise<string | undefined> {
  const stream = createReadStream(file, { encoding: "utf8", end: 256 * 1024 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let seen = 0;
  try {
    for await (const raw of lines) {
      if (++seen > HEADER_LINES) return undefined;
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { continue; }
      const cwd = parsed && typeof parsed === "object" ? pick(parsed as Record<string, unknown>) : undefined;
      if (typeof cwd === "string" && path.isAbsolute(cwd)) return cwd;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    lines.close();
    stream.destroy();
  }
}

/*
 * One sighting per session file changed since `since`. Claude files each
 * folder's sessions together, so the newest file names the folder for all of
 * them; Codex files by date, so only the folders for recent days are opened.
 */
export async function recentSessionSightings(env: NodeJS.ProcessEnv, since: number, now = Date.now()): Promise<SessionSighting[]> {
  const sightings: SessionSighting[] = [];
  let budget = MAX_FILES;

  const claudeRoot = HISTORY_SOURCES.claude.root(env);
  for (const entry of await readdir(claudeRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || budget <= 0) continue;
    const stamped = await Promise.all((await filesIn(path.join(claudeRoot, entry.name))).map(async (file) => ({ file, at: await mtime(file) })));
    const recent = stamped.filter((item) => item.at >= since).sort((a, b) => b.at - a.at).slice(0, budget);
    if (!recent.length) continue;
    budget -= recent.length;
    const cwd = await recordedCwd(recent[0]!.file, (line) => line.cwd);
    if (cwd) for (const item of recent) sightings.push({ agent: "claude", cwd, at: item.at });
  }

  const codexRoot = HISTORY_SOURCES.codex.root(env);
  for (let day = new Date(now); day.getTime() >= since - 86_400_000 && budget > 0; day = new Date(day.getTime() - 86_400_000)) {
    const dir = path.join(codexRoot, String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
    for (const file of (await filesIn(dir)).filter((name) => path.basename(name).startsWith("rollout-")).slice(0, budget)) {
      budget--;
      const at = await mtime(file);
      if (at < since) continue;
      const cwd = await recordedCwd(file, (line) => (line.payload as Record<string, unknown> | undefined)?.cwd);
      if (cwd) sightings.push({ agent: "codex", cwd, at });
    }
  }
  return sightings;
}

/**
 * The folder a project should be: the repository a session ran in, or the
 * folder itself. A linked worktree belongs to the repository it came from.
 */
export function repositoryRoot(cwd: string, home: string): string {
  for (let dir = cwd; dir !== path.dirname(dir) && dir !== home; dir = path.dirname(dir)) {
    const marker = path.join(dir, ".git");
    if (!existsSync(marker)) continue;
    try {
      if (statSync(marker).isDirectory()) return dir;
      const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(marker, "utf8"))?.[1]?.trim();
      const main = gitdir ? /^(.*)[\\/]\.git[\\/]worktrees[\\/]/.exec(path.resolve(dir, gitdir))?.[1] : undefined;
      return main ?? dir;
    } catch {
      return dir;
    }
  }
  return cwd;
}

/**
 * Sightings into suggestions: grouped by repository, kept when busy enough,
 * busiest first. Pure, so the rules are testable without any history on disk.
 */
export function suggestProjects(sightings: SessionSighting[], input: {
  /** Folders that are already projects. */
  known: string[];
  /** Trees whose sessions are never suggested: temporary folders, Capsule's own data and worktrees. */
  excluded: string[];
  /** Too broad to be a project, though sessions in folders under it are fine. */
  home: string;
  rootOf: (cwd: string) => string;
  exists: (folder: string) => boolean;
  minSessions?: number;
}): SuggestedProject[] {
  const inside = (folder: string, parent: string) => folder === parent || folder.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
  const known = input.known.map((folder) => path.resolve(folder));
  const groups = new Map<string, { sessions: number; agents: Set<ImportAgentId>; at: number }>();
  const roots = new Map<string, string>();
  for (const sighting of sightings) {
    const cwd = path.resolve(sighting.cwd);
    if (input.excluded.some((folder) => inside(cwd, path.resolve(folder)))) continue;
    let root = roots.get(cwd);
    if (root === undefined) roots.set(cwd, (root = input.rootOf(cwd)));
    if (root === path.resolve(input.home) || root === path.parse(root).root) continue;
    if (known.some((folder) => inside(root!, folder) || inside(folder, root!))) continue;
    const group = groups.get(root) ?? { sessions: 0, agents: new Set(), at: 0 };
    group.sessions++;
    group.agents.add(sighting.agent);
    group.at = Math.max(group.at, sighting.at);
    groups.set(root, group);
  }
  return [...groups]
    .filter(([root, group]) => group.sessions >= (input.minSessions ?? SUGGESTION_MIN_SESSIONS) && input.exists(root))
    .sort(([, a], [, b]) => b.sessions - a.sessions || b.at - a.at)
    .slice(0, MAX_SUGGESTIONS)
    .map(([root, group]) => ({
      path: root,
      name: path.basename(root),
      sessions: group.sessions,
      agents: [...group.agents].sort(),
      lastActivity: new Date(group.at).toISOString(),
    }));
}
