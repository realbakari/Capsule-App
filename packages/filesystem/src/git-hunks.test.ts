import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { hunkActions, parseUnifiedDiff, type DiffFile, type DiffScope, type ReviewFileDiffs } from "@capsule/shared";
import { applyHunk, checkHunks, readScopedDiff } from "./git-hunks.js";

// Each case runs a few dozen git processes; a loaded machine needs more than the default.
vi.setConfig({ testTimeout: 20_000 });

let root = "";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const write = (name: string, text: string) => writeFileSync(path.join(root, name), text);
const read = (name: string) => readFileSync(path.join(root, name), "utf8");
const lines = (count: number, change: (n: number) => string = (n) => `line ${n}`) =>
  Array.from({ length: count }, (_, i) => change(i + 1)).join("\n") + "\n";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "capsule-hunks-"));
  git("init", "-q", "-b", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.test");
  git("config", "core.autocrlf", "false");
  write("app.txt", lines(40));
  git("add", "."); git("commit", "-qm", "initial");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function file(scope: Exclude<DiffScope, "turn">, name: string): Promise<DiffFile | undefined> {
  return parseUnifiedDiff((await readScopedDiff(root, scope)).patch).find((item) => item.path === name);
}

async function diffs(scope: Exclude<DiffScope, "turn">, name: string): Promise<ReviewFileDiffs> {
  const shown = await file(scope, name);
  if (!shown) throw new Error(`no ${scope} diff for ${name}`);
  return scope === "uncommitted" ? { shown, staged: await file("staged", name), unstaged: await file("unstaged", name) } : { shown };
}

async function act(scope: Exclude<DiffScope, "turn">, name: string, hunk: number, action: "keep" | "reject" | "unstage") {
  const plan = hunkActions(scope, await diffs(scope, name), [hunk])[action];
  if (!plan) throw new Error(`${action} is not offered`);
  return applyHunk(root, plan);
}

it("keeps one hunk and rejects another, leaving the rest unstaged", async () => {
  write("app.txt", lines(40, (n) => n === 3 ? "THREE" : n === 20 ? "TWENTY" : n === 37 ? "THIRTY-SEVEN" : `line ${n}`));
  expect((await file("unstaged", "app.txt"))?.hunks).toHaveLength(3);

  expect(await act("unstaged", "app.txt", 0, "keep")).toEqual({ ok: true, detail: "Applied." });
  // The kept hunk left the unstaged diff, so the last change is now its second hunk.
  expect(await act("unstaged", "app.txt", 1, "reject")).toMatchObject({ ok: true });

  expect(git("diff", "--cached")).toContain("+THREE");
  expect(git("diff", "--cached")).not.toContain("TWENTY");
  expect(git("diff")).toContain("+TWENTY");
  expect(git("diff")).not.toContain("THREE");
  expect(read("app.txt")).toBe(lines(40, (n) => n === 3 ? "THREE" : n === 20 ? "TWENTY" : `line ${n}`));
  expect(git("show", ":app.txt")).toBe(lines(40, (n) => n === 3 ? "THREE" : `line ${n}`));
});

it("refuses a stale hunk with git's reason and changes nothing", async () => {
  write("app.txt", lines(40, (n) => n === 3 ? "THREE" : `line ${n}`));
  const plan = hunkActions("unstaged", await diffs("unstaged", "app.txt"), [0]);
  write("app.txt", lines(40, (n) => n === 3 ? "edited underneath" : `line ${n}`));
  const before = { worktree: read("app.txt"), index: git("show", ":app.txt") };

  const result = await applyHunk(root, plan.reject!);
  expect(result.ok).toBe(false);
  expect(result.detail).toMatch(/patch does not apply/);
  expect(await checkHunks(root, [plan.reject!, plan.keep!])).toEqual([false, true]);
  expect({ worktree: read("app.txt"), index: git("show", ":app.txt") }).toEqual(before);
});

it("rolls nothing forward when one part of an Uncommitted reject is stale", async () => {
  write("app.txt", lines(40, (n) => n === 3 ? "THREE" : `line ${n}`));
  git("add", "app.txt");
  const plan = hunkActions("uncommitted", await diffs("uncommitted", "app.txt"), [0]).reject!;
  expect(plan.index && plan.worktree).toBeTruthy();
  write("app.txt", lines(40, (n) => n === 3 ? "moved on" : `line ${n}`));
  expect((await applyHunk(root, plan)).ok).toBe(false);
  expect(git("show", ":app.txt")).toContain("THREE");
  expect(read("app.txt")).toContain("moved on");
});

it("in Uncommitted, keeps only the unstaged half and rejects a staged hunk everywhere", async () => {
  write("app.txt", lines(40, (n) => n === 3 ? "THREE" : `line ${n}`));
  git("add", "app.txt");
  write("app.txt", lines(40, (n) => n === 3 ? "THREE" : n === 30 ? "THIRTY" : `line ${n}`));

  expect(await act("uncommitted", "app.txt", 1, "keep")).toMatchObject({ ok: true });
  expect(git("diff")).toBe("");
  expect(await act("uncommitted", "app.txt", 0, "reject")).toMatchObject({ ok: true });
  expect(read("app.txt")).toBe(lines(40, (n) => n === 30 ? "THIRTY" : `line ${n}`));
  expect(git("show", ":app.txt")).toBe(read("app.txt"));
});

it("unstages one hunk from the Staged scope", async () => {
  write("app.txt", lines(40, (n) => n === 3 ? "THREE" : n === 30 ? "THIRTY" : `line ${n}`));
  git("add", "app.txt");
  expect(await act("staged", "app.txt", 1, "unstage")).toMatchObject({ ok: true });
  expect(git("diff", "--cached")).toContain("+THREE");
  expect(git("diff", "--cached")).not.toContain("THIRTY");
  expect(git("diff")).toContain("+THIRTY");
});

it("treats an untracked file as one hunk: keep stages it, reject deletes it", async () => {
  write("kept.txt", "new\n");
  write("dropped.txt", "gone\n");
  expect(await act("uncommitted", "kept.txt", 0, "keep")).toMatchObject({ ok: true });
  expect(git("diff", "--cached", "--name-status")).toBe("A\tkept.txt\n");
  expect(await act("uncommitted", "dropped.txt", 0, "reject")).toMatchObject({ ok: true });
  expect(existsSync(path.join(root, "dropped.txt"))).toBe(false);
});

it("round-trips carriage returns, a missing final newline, and awkward names", async () => {
  const name = "tab\there é.txt";
  write(name, "a\r\nb\r\nc");
  write("plain.txt", "one\ntwo");
  git("add", "."); git("commit", "-qm", "awkward");
  write(name, "a\r\nB\r\nc\r\n");
  write("plain.txt", "one\nTWO");
  expect(await act("unstaged", name, 0, "keep")).toMatchObject({ ok: true });
  expect(git("show", `:${name}`)).toBe("a\r\nB\r\nc\r\n");
  expect(await act("unstaged", "plain.txt", 0, "reject")).toMatchObject({ ok: true });
  expect(read("plain.txt")).toBe("one\ntwo");
});

it("edits a staged rename in place without undoing the move", async () => {
  git("mv", "app.txt", "moved.txt");
  write("moved.txt", lines(40, (n) => n === 3 ? "THREE" : `line ${n}`));
  git("add", "moved.txt");
  const shown = await file("staged", "moved.txt");
  expect(shown).toMatchObject({ status: "renamed", oldPath: "app.txt" });
  expect(await act("staged", "moved.txt", 0, "unstage")).toMatchObject({ ok: true });
  expect(git("diff", "--cached", "-M", "--name-status")).toMatch(/^R100\tapp\.txt\tmoved\.txt\n$/);
  expect(git("diff", "--name-only")).toBe("moved.txt\n");
});

it("compares Branch from where it left the default branch, untracked files included", async () => {
  git("checkout", "-qb", "feature");
  write("app.txt", lines(40, (n) => n === 5 ? "FIVE" : `line ${n}`));
  git("commit", "-qam", "feature work");
  write("loose.txt", "loose\n");
  const scoped = await readScopedDiff(root, "branch");
  expect(scoped.base).toBe("main");
  expect(parseUnifiedDiff(scoped.patch).map((item) => item.path).sort()).toEqual(["app.txt", "loose.txt"]);
});
