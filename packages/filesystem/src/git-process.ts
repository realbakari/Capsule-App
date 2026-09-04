import { execFile } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { realpath } from "node:fs/promises";
import path from "node:path";

export function git(cwd: string, args: string[], env = process.env): Promise<{ ok: boolean; stdout: string; stderr: string; }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, env: { ...env, GIT_TERMINAL_PROMPT: "0" }, encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout, stderr: (stderr || error?.message || "").trim() });
    });
  });
}

/** One queue per Git common directory: linked worktrees share refs and locks. */
export class RepositoryQueue {
  private tails = new Map<string, Promise<unknown>>();
  private reads = new Map<string, Promise<unknown>>();
  private owners = new AsyncLocalStorage<string>();

  run<T>(key: string, operation: () => Promise<T>, readKey?: string): Promise<T> {
    if (this.owners.getStore() === key) return operation();
    const identity = JSON.stringify([key, readKey]);
    if (readKey) {
      const existing = this.reads.get(identity);
      if (existing) return existing as Promise<T>;
    } else {
      // A read already queued before a write cannot answer a post-write read.
      for (const id of this.reads.keys()) if (JSON.parse(id)[0] === key) this.reads.delete(id);
    }
    const previous = this.tails.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(() => this.owners.run(key, operation));
    this.tails.set(key, pending);
    if (readKey) this.reads.set(identity, pending);
    const clear = () => {
      if (this.tails.get(key) === pending) this.tails.delete(key);
      if (this.reads.get(identity) === pending) this.reads.delete(identity);
    };
    void pending.then(clear, clear);
    return pending;
  }
}

const queue = new RepositoryQueue();
const resolving = new Map<string, Promise<string>>();
async function repositoryKey(cwd: string): Promise<string> {
  const canonical = await realpath(cwd).catch(() => path.resolve(cwd));
  let pending = resolving.get(canonical);
  if (!pending) {
    pending = git(canonical, ["rev-parse", "--git-common-dir"]).then(async (result) =>
      result.ok ? realpath(path.resolve(canonical, result.stdout.trim())) : canonical);
    resolving.set(canonical, pending);
    const clear = () => { if (resolving.get(canonical) === pending) resolving.delete(canonical); };
    void pending.then(clear, clear);
  }
  return pending;
}

export async function inRepository<T>(cwd: string | undefined, operation: () => Promise<T>, readKey?: string): Promise<T> {
  if (!cwd) return operation();
  return queue.run(await repositoryKey(cwd), operation, readKey && JSON.stringify([path.resolve(cwd), readKey]));
}
