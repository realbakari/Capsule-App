import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { GitStatus } from "@capsule/shared";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 2500,
  });
  if (result.status !== 0) return "";
  return (result.stdout ?? "").trim();
}

export function readGitStatus(workingDirectory?: string): GitStatus {
  if (!workingDirectory || !fs.existsSync(workingDirectory)) {
    return { available: false, isRepo: false, dirty: false, changed: 0, summary: "No working directory." };
  }
  const gitDir = path.join(workingDirectory, ".git");
  const inside = git(workingDirectory, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true" && !fs.existsSync(gitDir)) {
    return {
      available: true,
      isRepo: false,
      dirty: false,
      changed: 0,
      summary: "Not a git repository.",
    };
  }
  const branch =
    git(workingDirectory, ["branch", "--show-current"]) ||
    git(workingDirectory, ["rev-parse", "--abbrev-ref", "HEAD"]) ||
    "HEAD";
  const porcelain = git(workingDirectory, ["status", "--porcelain"]);
  const changed = porcelain ? porcelain.split(/\r?\n/).filter(Boolean).length : 0;
  return {
    available: true,
    isRepo: true,
    branch,
    dirty: changed > 0,
    changed,
    summary: changed > 0 ? `${branch} · ${changed} changed` : `${branch} · clean`,
  };
}
