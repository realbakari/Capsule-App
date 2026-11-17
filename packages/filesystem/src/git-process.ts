import { execFile } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { localTimings } from "@capsule/shared";

export function git(cwd: string, args: string[], env = process.env, timeout = 30_000): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode?: number }> {
  const operation = gitOperation(args);
  const label = operation === "status" ? "git.status" : operation === "diff" ? "git.diff" : operation === "show" ? "git.show"
    : ["rev-parse", "branch", "for-each-ref", "update-ref"].includes(operation ?? "") ? "git.refs"
    : ["write-tree", "read-tree", "add"].includes(operation ?? "") ? "git.snapshot" : "git.process";
  const end = localTimings.start(label);
  return new Promise((resolve) => {
    execFile("git", args, { cwd, env: { ...env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      end(Boolean(error));
      // Node's message for a process stopped at the timeout only repeats the command line.
      const stopped = error?.killed && error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && !stderr.trim() ? `\`git ${operation}\` took longer than ${seconds(timeout)} and was stopped.` : "";
      resolve({ ok: !error, stdout, stderr: (stopped || stderr || (error ? silentFailure(operation, error) : "")).trim(),
        // Missing binaries, timeouts and output limits are not safe retry signals.
        exitCode: !error ? 0 : !error.killed && !error.signal && typeof error.code === "number" ? error.code : undefined });
    });
  });
}

/** The subcommand, past global options such as `-c key=value` and `--literal-pathspecs`. */
export function gitOperation(args: readonly string[]): string {
  return args.find((arg, index) => !arg.startsWith("-") && args[index - 1] !== "-c") ?? "git";
}

/*
 * A failure with nothing on stderr. Node's own message is "Command failed:"
 * and the whole command line, which tells a reader nothing they can act on.
 */
export function silentFailure(operation: string, error: { code?: string | number | null }): string {
  if (error.code === "ENOENT") return "Git is not installed, or it is not on this computer's PATH.";
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return `\`git ${operation}\` printed more than Capsule reads at once.`;
  return typeof error.code === "number" ? `\`git ${operation}\` failed with exit code ${error.code}.` : `\`git ${operation}\` failed.`;
}

function seconds(ms: number): string {
  const count = Math.max(1, Math.round(ms / 1000));
  return `${count} second${count === 1 ? "" : "s"}`;
}

/** Display-only reads may return an excerpt. Mutating Git operations must use git(). */
export function gitExcerpt(cwd: string, args: string[], maxBytes: number, timeout = 30_000): Promise<{ stdout: string; truncated: boolean }> {
  const end = localTimings.start("git.diff");
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8", timeout, maxBuffer: maxBytes }, (error, stdout, stderr) => {
      // Node stops our child at the limit. A stderr overflow or a timeout is
      // still a failure, never evidence of a successfully read patch.
      const truncated = error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && error.message.startsWith("stdout maxBuffer");
      end(Boolean(error) && !truncated);
      // As in git(): a timeout says what was stopped, not the whole command line.
      const operation = gitOperation(args);
      const stopped = error?.killed && error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && !stderr.trim() ? `\`git ${operation}\` took longer than ${seconds(timeout)} and was stopped.` : "";
      if (error && !truncated) reject(new Error(stopped || stderr.trim() || silentFailure(operation, error)));
      else resolve({ stdout, truncated });
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
    const endWait = localTimings.start("git.queue");
    const pending = previous.catch(() => undefined).then(() => { endWait(); return this.owners.run(key, operation); });
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
