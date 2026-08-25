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
      path: path.join(relative, entry.name),
      type: entry.isDirectory() ? "directory" : "file",
    }));
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
