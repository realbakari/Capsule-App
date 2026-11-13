import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Folders of customization files, one file per resource. A later feature adds
 * a parser for its kind; discovery, scopes and limits stay here.
 */
export const RESOURCE_KINDS = {
  commands: { folder: "commands", extension: ".md" },
  profiles: { folder: "profiles", extension: ".md" },
  styles: { folder: "styles", extension: ".md" },
  themes: { folder: "themes", extension: ".json" },
} as const satisfies Record<string, { folder: string; extension: string }>;

export type ResourceKind = keyof typeof RESOURCE_KINDS;

export interface ResourceFile {
  kind: ResourceKind;
  /** Path below the kind's folder without the extension, `/`-separated: `git/commit`. */
  name: string;
  path: string;
  scope: "user" | "project";
  text: string;
}

const MAX_DEPTH = 4;
const MAX_FILES = 500;
const MAX_BYTES = 256 * 1024;

/** Every file of one kind under the given roots, user first, each sorted by name. */
export function listResources(kind: ResourceKind, roots: ReadonlyArray<{ scope: "user" | "project"; dir: string }>): ResourceFile[] {
  return roots.flatMap(({ scope, dir }) => listResourceFolder(kind, scope, path.join(dir, RESOURCE_KINDS[kind].folder)));
}

/** The files of one kind in one folder and below it, sorted by name. */
export function listResourceFolder(kind: ResourceKind, scope: "user" | "project", base: string): ResourceFile[] {
  const { extension } = RESOURCE_KINDS[kind];
  const files: ResourceFile[] = [];
  const walk = (current: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(extension)) continue;
      try {
        if (statSync(full).size > MAX_BYTES) continue;
        const name = path.relative(base, full).slice(0, -extension.length).split(path.sep).join("/");
        files.push({ kind, name, path: full, scope, text: readFileSync(full, "utf8") });
      } catch {
        // Removed while listing.
      }
    }
  };
  walk(base, 1);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
