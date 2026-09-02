import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface CloneRepositoryResult {
  ok: boolean;
  detail: string;
  path?: string;
  name?: string;
}

export function repositoryNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[/?#]+$/, "");
  const tail = trimmed.split(/[/:]/).filter(Boolean).pop() ?? "repository";
  const withoutGit = tail.replace(/\.git$/i, "");
  return withoutGit.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repository";
}

export function cloneRepositoryArgs(url: string, destination: string): string[] {
  return ["clone", "--", url, destination];
}

function validGitUrl(url: string): boolean {
  if (!url || url.startsWith("-")) return false;
  return /^(https?|ssh|git):\/\//i.test(url) || /^[\w.-]+@[\w.-]+:.+/.test(url);
}

export async function cloneRepository(
  parentDirectory: string,
  url: string,
  requestedName?: string,
): Promise<CloneRepositoryResult> {
  const remote = url.trim();
  if (!validGitUrl(remote)) {
    return { ok: false, detail: "Enter an HTTPS, SSH, or git repository URL." };
  }
  const parent = path.resolve(parentDirectory);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    return { ok: false, detail: "Choose an existing destination folder." };
  }
  const name = (requestedName?.trim() || repositoryNameFromUrl(remote))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (!name) return { ok: false, detail: "Repository name is empty." };
  const destination = path.join(parent, name);
  if (fs.existsSync(destination)) {
    return { ok: false, detail: `A folder named ${name} already exists there.` };
  }

  return await new Promise((resolve) => {
    const child = spawn("git", cloneRepositoryArgs(remote, destination), {
      cwd: parent,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-16_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => resolve({ ok: false, detail: error.message }));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, detail: `Cloned ${name}.`, path: destination, name });
        return;
      }
      // Git owns this newly-created destination. Remove only that exact path
      // after a failed clone so retrying does not hit a half-populated folder.
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
      resolve({ ok: false, detail: output.trim() || `Git clone exited with code ${code ?? "unknown"}.` });
    });
  });
}

