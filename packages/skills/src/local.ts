import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { FileEntry, Skill } from "@capsule/shared";
import { parseSkillDoc } from "./github.js";

export interface GlobalSkillRoot {
  id: string;
  label: string;
  directory: string;
}

const MAX_SKILL_BYTES = 1_000_000;
const MAX_SCAN_DEPTH = 6;

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve a path inside a discovered skill folder. Both the lexical path and
 * the real path are checked, so a symlink inside a skill cannot escape to an
 * unrelated part of the machine.
 */
export function resolveGlobalSkillFile(location: string, relative = "."): string {
  const root = fs.realpathSync(path.dirname(location));
  const lexical = path.resolve(root, relative);
  if (!isWithin(root, lexical)) throw new Error("Path is outside the skill folder");
  const resolved = fs.realpathSync(lexical);
  if (!isWithin(root, resolved)) throw new Error("Path is outside the skill folder");
  return resolved;
}

/** List one level of a discovered skill folder without following escapes. */
export function listGlobalSkillFiles(location: string, relative = "."): FileEntry[] {
  const root = fs.realpathSync(path.dirname(location));
  const directory = resolveGlobalSkillFile(location, relative);
  if (!fs.statSync(directory).isDirectory()) throw new Error("Skill path is not a folder");
  const prefix = relative === "." ? "" : relative.replaceAll("\\", "/").replace(/^\.\//, "");
  const files: FileEntry[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const child = path.join(directory, entry.name);
    try {
      const resolved = fs.realpathSync(child);
      if (!isWithin(root, resolved)) continue;
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory() && !stat.isFile()) continue;
      files.push({
        name: entry.name,
        path: prefix ? `${prefix}/${entry.name}` : entry.name,
        type: stat.isDirectory() ? "directory" : "file",
      });
    } catch {
      // A broken or unreadable entry should not hide the rest of the folder.
    }
  }
  return files.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

/** Roots used by the shared skills CLI and the supported coding agents. */
export function defaultGlobalSkillRoots(
  home = os.homedir(),
  environment: NodeJS.ProcessEnv = process.env,
): GlobalSkillRoot[] {
  const claudeConfig = environment.CLAUDE_CONFIG_DIR?.trim();
  const claudeRoot = claudeConfig
    ? path.resolve(claudeConfig.replace(/^~(?=$|[\\/])/, home))
    : path.join(home, ".claude");
  return [
    { id: "agents", label: "Agent Skills", directory: path.join(home, ".agents", "skills") },
    { id: "codex", label: "Codex", directory: path.join(home, ".codex", "skills") },
    { id: "claude", label: "Claude Code", directory: path.join(claudeRoot, "skills") },
    {
      id: "opencode",
      label: "OpenCode",
      directory: path.join(home, ".config", "opencode", "skills"),
    },
  ];
}

function frontmatterValue(markdown: string, key: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1];
  if (!block) return undefined;
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(block);
  if (!match?.[1]) return undefined;
  const value = match[1].trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
  return (quoted?.[2] ?? value).trim() || undefined;
}

function globalSkillId(root: GlobalSkillRoot, relativeDirectory: string): string {
  const suffix = relativeDirectory
    .replaceAll("\\", "/")
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replaceAll("/", ":");
  return `global:${root.id}:${suffix}`;
}

/**
 * Discover installed skills without importing an agent's runtime. The scan is
 * best-effort and read-only: unreadable folders and invalid documents are
 * skipped, and symlinked installs are deduplicated by their canonical path.
 */
export function discoverGlobalSkills(
  roots: GlobalSkillRoot[] = defaultGlobalSkillRoots(),
): Skill[] {
  const found: Skill[] = [];
  const seenDocuments = new Set<string>();

  const walk = (root: GlobalSkillRoot, directory: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    const document = entries.find(
      (entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name === "SKILL.md",
    );
    if (document) {
      const location = path.join(directory, document.name);
      let canonical = location;
      let content: string;
      try {
        canonical = fs.realpathSync(location);
        if (seenDocuments.has(canonical)) return;
        const stat = fs.statSync(canonical);
        if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) return;
        content = fs.readFileSync(canonical, "utf8");
      } catch {
        return;
      }
      seenDocuments.add(canonical);
      const relativeDirectory = path.relative(root.directory, directory) || path.basename(directory);
      const fallbackName = path.basename(directory);
      found.push({
        id: globalSkillId(root, relativeDirectory),
        name: frontmatterValue(content, "name") ?? fallbackName,
        description: parseSkillDoc(content).description ?? "",
        source: root.label,
        status: "installed",
        requirements: [],
        permissions: { filesystem: "approval" },
        validation: "passed",
        content,
        tags: ["global", root.id],
        location,
        managedExternally: true,
      });
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!(entry.isDirectory() || entry.isSymbolicLink())) continue;
      walk(root, path.join(directory, entry.name), depth + 1);
    }
  };

  for (const root of roots) walk(root, root.directory, 0);
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}
