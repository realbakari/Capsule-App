import fs from "node:fs";
import path from "node:path";

import type { FileEntry } from "@capsule/shared";
import { readPreviewFile } from "./preview.js";

export type { FileEntry };
export { inRepository } from "./git-process.js";
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
  clearGhCache,
  createPullRequest,
  createPullRequestArgs,
  enrichGitStatus,
  ghAvailable,
  parseLabels,
  setPullRequestListener,
  lastCommitSubject,
  listPullRequests,
  parsePullRequestDetail,
  readPullRequestDetail,
  readCommitDiff,
  mergePullRequest,
  mergePullRequestArgs,
  pushArgs,
  pushCurrentBranch,
  parsePullRequestList,
  pollPullRequest,
  pollPullRequestList,
  pullRequestListFailure,
  viewPullRequest,
} from "./github.js";
export {
  captureCheckpoint,
  readWorktreeRevision,
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

  /*
   * Answers from the project's remembered file list, ranked.
   *
   * This used to walk the tree on every query, stop at a fixed depth, and
   * return whatever the walk reached first — so a deep file was invisible and
   * "index" in a large project answered with eighty arbitrary ones.
   */
  search(query = "", limit = 80): FileEntry[] {
    if (!this.projectRoot) return [];
    const root = this.resolve(".");
    if (!fs.existsSync(root)) return [];
    return rankFiles(projectFiles(root), query, limit).map((file) => ({
      name: file.name,
      path: file.path,
      type: "file" as const,
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

  preview(relative: string) {
    return readPreviewFile(this.resolve(relative), relative.replaceAll("\\", "/"));
  }

  /*
   * Atomic, because this is how the editor and the agent write the user's own
   * source. A truncating write that fails halfway leaves them with an empty
   * file and no copy of what was in it.
   */
  write(relative: string, content: string): void {
    writeFileAtomic(this.resolve(relative), content);
  }
}
import { projectFiles, rankFiles } from "./file-index.js";
import { writeFileAtomic } from "./atomic-write.js";

export {
  clearFileIndex,
  projectFiles,
  rankFiles,
  readProjectFiles,
  scorePath,
  FILE_INDEX_TTL_MS,
  type RankedFile,
} from "./file-index.js";
export { writeFileAtomic } from "./atomic-write.js";
export { avatarsFor, clearAvatarCache } from "./avatars.js";
