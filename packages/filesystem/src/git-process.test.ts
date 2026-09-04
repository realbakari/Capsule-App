import { describe, expect, it, vi } from "vitest";
import { RepositoryQueue, git, inRepository } from "./git-process.js";
import { mkdtempSync, realpathSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

it("shares the repository lock with linked worktrees without blocking the event loop", async () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "capsule-queue-")));
  expect((await git(dir, ["init", "-q"])).ok).toBe(true);
  expect((await git(dir, ["-c", "user.name=Capsule", "-c", "user.email=capsule@localhost", "commit", "--allow-empty", "-m", "base"])).ok).toBe(true);
  const linked = path.join(dir, "linked");
  expect((await git(dir, ["worktree", "add", "-b", "linked", linked])).ok).toBe(true);
  const started = deferred(); const gate = deferred(); let entered = false;
  const first = inRepository(dir, async () => { started.resolve(); await gate.promise; });
  await started.promise;
  const second = inRepository(linked, async () => { entered = true; });
  let ticks = 0; const timer = setInterval(() => ticks++, 10);
  try {
    const slow = await git(dir, ["-c", "alias.wait=!sleep 0.1", "wait"]);
    expect(slow.ok).toBe(true); expect(ticks).toBeGreaterThan(0); expect(entered).toBe(false);
  } finally { clearInterval(timer); gate.resolve(); await Promise.all([first, second]); }
  expect(entered).toBe(true);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

describe("repository queue", () => {
  it("shares duplicate reads but never shares a pre-write read after a write", async () => {
    const queue = new RepositoryQueue(); const gate = deferred(); const order: string[] = [];
    const read = vi.fn(async () => { order.push("read"); await gate.promise; return 1; });
    const first = queue.run("repo", read, "status");
    expect(queue.run("repo", read, "status")).toBe(first);
    const write = queue.run("repo", async () => { order.push("write"); });
    const after = queue.run("repo", async () => { order.push("after"); return 2; }, "status");
    expect(after).not.toBe(first);
    gate.resolve(); await Promise.all([first, write, after]);
    expect(order).toEqual(["read", "write", "after"]); expect(read).toHaveBeenCalledTimes(1);
  });
  it("allows independent repositories to proceed and recovers after a rejection", async () => {
    const queue = new RepositoryQueue(); const gate = deferred();
    const blocked = queue.run("a", async () => { await gate.promise; throw new Error("failed"); });
    const caught = expect(blocked).rejects.toThrow("failed");
    expect(await queue.run("b", async () => "ready")).toBe("ready");
    const next = queue.run("a", async () => "recovered");
    gate.resolve(); await caught; expect(await next).toBe("recovered");
  });
  it("keeps a composite operation in one lock without deadlocking nested helpers", async () => {
    const queue = new RepositoryQueue(); const order: string[] = [];
    await Promise.all([
      queue.run("a", async () => { order.push("stage"); await queue.run("a", async () => { order.push("commit"); }); }),
      queue.run("a", async () => { order.push("checkout"); }),
    ]);
    expect(order).toEqual(["stage", "commit", "checkout"]);
  });
});
