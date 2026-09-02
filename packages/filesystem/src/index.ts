import fs from "node:fs";
import path from "node:path";

import type { FileEntry } from "@capsule/shared";
import { readPreviewFile } from "./preview.js";

export type { FileEntry };
export {
  cloneRepository,
  cloneRepositoryArgs,
  repositoryNameFromUrl,
  type CloneRepositoryResult,
} from "./clone.js";
export {
  attachmentPromptBlock,
  MAX_MESSAGE_ATTACHMENT_BYTES,
  MAX_MESSAGE_ATTACHMENTS,
  validateMessageAttachments,
} from "./attachments.js";
export {
  checkoutBranch,
  commitAll,
  createBranch,
  initializeRepository,
  discardFile,
  readGitDiff,
  readGitStatus,
  stageFile,
} from "./git.js";
export {
  createPullRequest,
  createPullRequestArgs,
  enrichGitStatus,
  ghAvailable,
  lastCommitSubject,
  listPullRequests,
  mergePullRequest,
  mergePullRequestArgs,
  pushArgs,
  pushCurrentBranch,
  parsePullRequestList,
  viewPullRequest,
} from "./github.js";
export {
  captureCheckpoint,
  checkpointNumstat,
  checkpointRef,
  deleteCheckpoints,
  diffCheckpoints,
  hasCheckpoint,
  isGitRepository,
  restoreCheckpoint,
} from "./checkpoints.js";
export { detectSourceControlTools, type ToolStatus } from "./tooling.js";
export {
  listListeningPorts,
  listLocalServers,
  parseLsofPorts,
  parsePageTitle,
  probeLocalServer,
  type ListeningPort,
} from "./ports.js";
export {
  readAgentProcesses,
  readProcessTable,
  selectAgentPids,
  type AgentProcess,
  type ProcessRow,
} from "./process-tree.js";
export { readProjectFile } from "./project-file.js";
export { createWorktree, removeWorktree, type WorktreeResult } from "./worktrees.js";
export {
  isSupportedProjectIcon,
  readProjectIconDataUrl,
  resolveProjectIconPath,
} from "./project-icons.js";
export { previewFromBytes, readPreviewFile } from "./preview.js";
export { searchContents } from "./search.js";

export class FilesystemAdapter {
  constructor(private readonly projectRoot?: string) {}

  resolve(target: string): string {
    // Without a project root there is nothing to contain paths against, and
    // falling back to process.cwd() silently sandboxed the adapter to whatever
    // directory the app happened to launch from. Refuse instead.
    if (!this.projectRoot) {
      throw new Error("Project has no working directory");
    }
    const root = path.resolve(this.projectRoot);
    const resolved = path.resolve(root, target);
    // A raw string prefix test also matches siblings that merely start with the
    // root's name (`/x/app` vs `/x/app-private`). Compare on path segments.
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
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

  preview(relative: string) {
    return readPreviewFile(this.resolve(relative), relative.replaceAll("\\", "/"));
  }

  write(relative: string, content: string): void {
    const file = this.resolve(relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
}
