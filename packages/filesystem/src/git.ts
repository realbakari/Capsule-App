import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { GitChange, GitStatus } from "@capsule/shared";

function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 4000,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: (result.stderr ?? "").trim(),
  };
}

function parsePorcelain(text: string): GitChange[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2).trim() || line[0] || "?";
      const rest = line.slice(3);
      const filePath = rest.includes(" -> ") ? rest.split(" -> ").pop() ?? rest : rest;
      return { path: filePath, code };
    });
}

export function readGitStatus(workingDirectory?: string): GitStatus {
  if (!workingDirectory || !fs.existsSync(workingDirectory)) {
    return {
      available: false,
      isRepo: false,
      dirty: false,
      changed: 0,
      summary: "No working directory.",
      files: [],
      branches: [],
    };
  }
  const gitDir = path.join(workingDirectory, ".git");
  const inside = git(workingDirectory, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.stdout.trim() !== "true" && !fs.existsSync(gitDir)) {
    return {
      available: true,
      isRepo: false,
      dirty: false,
      changed: 0,
      summary: "Not a git repository.",
      files: [],
      branches: [],
    };
  }
  const branch =
    git(workingDirectory, ["branch", "--show-current"]).stdout.trim() ||
    git(workingDirectory, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim() ||
    "HEAD";
  const porcelain = git(workingDirectory, ["status", "--porcelain"]).stdout;
  const files = parsePorcelain(porcelain);
  const branches = git(workingDirectory, ["branch", "--format=%(refname:short)"])
    .stdout.split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    available: true,
    isRepo: true,
    branch,
    dirty: files.length > 0,
    changed: files.length,
    summary: files.length > 0 ? `${branch} · ${files.length} changed` : `${branch} · clean`,
    files,
    branches,
  };
}

export function checkoutBranch(workingDirectory: string, branch: string): { ok: boolean; detail: string } {
  const name = branch.trim();
  if (!name) return { ok: false, detail: "Branch name is empty." };
  const result = git(workingDirectory, ["checkout", name]);
  if (result.ok) return { ok: true, detail: `Checked out ${name}.` };
  return { ok: false, detail: result.stderr || result.stdout || "Checkout failed." };
}

export function readGitDiff(workingDirectory: string, relative?: string): string {
  const args = relative ? ["diff", "--", relative] : ["diff"];
  const result = git(workingDirectory, args);
  if (result.stdout.trim()) return result.stdout;
  const staged = git(workingDirectory, relative ? ["diff", "--cached", "--", relative] : ["diff", "--cached"]);
  return staged.stdout.trim() ? staged.stdout : result.stderr || "";
}
