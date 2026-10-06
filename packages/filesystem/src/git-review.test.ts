import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { parseUnifiedDiff } from "@capsule/shared";
import { readGitDiff, readGitStatus, stageFile } from "./git.js";
import { parseNumstat, parsePorcelain } from "./git-output.js";

it("polls changed files without refreshing the user's index or disturbing staging", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "capsule-index-read-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init", "-q"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.test");
    writeFileSync(path.join(root, "unchanged.txt"), "same\n");
    writeFileSync(path.join(root, "changed.txt"), "before\n");
    git("add", "."); git("commit", "-qm", "initial");
    writeFileSync(path.join(root, "changed.txt"), "staged\n"); git("add", "changed.txt");
    writeFileSync(path.join(root, "changed.txt"), "working\n");
    utimesSync(path.join(root, "unchanged.txt"), new Date(0), new Date(0));
    const index = path.join(root, ".git", "index");
    const before = readFileSync(index); const modified = statSync(index).mtimeMs;
    const status = await readGitStatus(root);
    expect(status.files).toEqual([{ code: "MM", path: "changed.txt", added: 1, removed: 1 }]);
    expect(readFileSync(index).equals(before)).toBe(true);
    expect(statSync(index).mtimeMs).toBe(modified);
    expect(git("show", ":changed.txt").toString()).toBe("staged\n");
    await stageFile(root, "changed.txt");
    expect(git("show", ":changed.txt").toString()).toBe("working\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("keeps NUL-delimited rename destinations and literal whitespace", () => {
  expect(parsePorcelain("R  new\tname\n.ts\0old.ts\0 M spaced name \0")).toEqual([
    { code: "R", path: "new\tname\n.ts" }, { code: "M", path: "spaced name " },
  ]);
  expect(parseNumstat("2\t3\t\0old.ts\0new\tname\n.ts\0-\t-\timage.png\0")).toEqual([
    { path: "new\tname\n.ts", added: 2, removed: 3 }, { path: "image.png" },
  ]);
});

it("reviews staged, unstaged and new files together, preserving Git-quoted paths", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "capsule-review-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.test");
  const names = ["stage.ts", "both.ts", "space name.ts", "é\tline\nname.ts", ":(glob)*.ts"];
  for (const name of names) writeFileSync(path.join(root, name), "base\n");
  git("add", "."); git("commit", "-m", "initial");
  writeFileSync(path.join(root, names[0]!), "staged\n"); await stageFile(root, names[0]!);
  writeFileSync(path.join(root, names[1]!), "staged intermediate\n"); await stageFile(root, names[1]!);
  writeFileSync(path.join(root, names[1]!), "final\n");
  for (const name of names.slice(2)) writeFileSync(path.join(root, name), "changed\n");
  writeFileSync(path.join(root, "new file.ts"), "new file\n");
  const status = await readGitStatus(root);
  expect(status.files.find((file) => file.path === "both.ts")).toMatchObject({ added: 1, removed: 1 });
  expect(status.files.find((file) => file.path === "new file.ts")?.added).toBe(1);
  expect(status.files.map((file) => file.path).sort()).toEqual([...names, "new file.ts"].sort());
  const patch = await readGitDiff(root);
  expect(parseUnifiedDiff(patch).map((file) => file.path).sort()).toEqual([...names, "new file.ts"].sort());
  expect(patch).toContain("+final"); expect(patch).not.toContain("+staged intermediate");
  const literal = parseUnifiedDiff(await readGitDiff(root, ":(glob)*.ts"));
  expect(literal.map((file) => file.path)).toEqual([":(glob)*.ts"]);
  await stageFile(root, ":(glob)*.ts");
  expect(git("diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean).sort()).toEqual([names[0], names[1], names[4]].sort());
});

it("reviews new and staged files before the first commit", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "capsule-unborn-"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  writeFileSync(path.join(root, "new.ts"), "new\n");
  writeFileSync(path.join(root, "staged.ts"), "staged\n");
  await stageFile(root, "staged.ts");
  expect(parseUnifiedDiff(await readGitDiff(root)).map((file) => file.path).sort()).toEqual(["new.ts", "staged.ts"]);
});

it("preserves metadata paths for working-tree and untracked diffs under custom Git presentation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "capsule-review-prefix-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.name", "Test"); git("config", "user.email", "test@example.test");
    git("config", "core.filemode", "true");
    git("config", "diff.noprefix", "true"); git("config", "color.ui", "always");
    writeFileSync(path.join(root, "script.sh"), "echo fixture\n");
    git("add", "."); git("commit", "-qm", "initial");
    chmodSync(path.join(root, "script.sh"), 0o755);
    writeFileSync(path.join(root, "empty file.txt"), "");
    writeFileSync(path.join(root, "binary.dat"), Buffer.from([0, 1, 0]));
    const patch = await readGitDiff(root);
    expect(parseUnifiedDiff(patch).map((file) => file.path).sort()).toEqual(["binary.dat", "empty file.txt", "script.sh"]);
    expect(patch).not.toContain("\u001b[");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
