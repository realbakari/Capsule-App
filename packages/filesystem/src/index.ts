import fs from "node:fs";
import path from "node:path";

import type { FileEntry } from "@capsule/shared";

export type { FileEntry };
export { readGitStatus } from "./git.js";

export class FilesystemAdapter {
  constructor(private readonly projectRoot?: string) {}

  resolve(target: string): string {
    const root = this.projectRoot ? path.resolve(this.projectRoot) : undefined;
    const resolved = path.resolve(root ?? process.cwd(), target);
    if (root && !resolved.startsWith(root)) {
      throw new Error("Path is outside the project working directory");
    }
    return resolved;
  }

  list(relative = "."): FileEntry[] {
    const dir = this.resolve(relative);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      path: path.posix.join(relative === "." ? "" : relative.replaceAll("\\", "/"), entry.name).replace(/^\//, ""),
      type: entry.isDirectory() ? "directory" : "file",
    }));
  }

  search(query = "", limit = 80): FileEntry[] {
    if (!this.projectRoot) return [];
    const root = this.resolve(".");
    if (!fs.existsSync(root)) return [];
    const skip = new Set(["node_modules", ".git", "dist", "out", ".next", "coverage", "build", "Pods"]);
    const needle = query.trim().toLowerCase();
    const matches: FileEntry[] = [];
    const walk = (dir: string, relative: string, depth: number) => {
      if (matches.length >= limit || depth > 6) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (matches.length >= limit) return;
        if (entry.name === ".DS_Store") continue;
        if (skip.has(entry.name)) continue;
        if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".gitignore") continue;
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, rel, depth + 1);
          continue;
        }
        if (!needle || rel.toLowerCase().includes(needle) || entry.name.toLowerCase().includes(needle)) {
          matches.push({ name: entry.name, path: rel, type: "file" });
        }
      }
    };
    walk(root, "", 0);
    return matches;
  }

  read(relative: string): string {
    const file = this.resolve(relative);
    const stat = fs.statSync(file);
    if (stat.size > 1_000_000) {
      throw new Error("File is too large to preview");
    }
    return fs.readFileSync(file, "utf8");
  }

  write(relative: string, content: string): void {
    const file = this.resolve(relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
}
