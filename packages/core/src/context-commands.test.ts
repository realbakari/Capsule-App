import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { findCheckCommand, runContextCommand } from "./context-commands.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "capsule-check-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

it("finds the project's check script and its package manager", async () => {
  expect(findCheckCommand(dir, [])).toBeUndefined();
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { lint: "eslint ." } }));
  await writeFile(path.join(dir, "yarn.lock"), "");
  expect(findCheckCommand(dir, [])).toEqual({ command: "yarn run lint", source: "script", name: "lint" });
  expect(findCheckCommand(dir, [{ id: "c", name: "Check", command: "make check", check: true }])?.command).toBe("make check");
});

it("runs a command in the folder, holds the lease while it runs, and keeps failing output", async () => {
  let held = 0;
  const lease = () => { held++; return () => { held--; }; };
  const ok = await runContextCommand(dir, "pwd", 10_000, lease);
  expect(ok.exitCode).toBe(0);
  expect(ok.output.trim().endsWith(path.basename(dir))).toBe(true);
  const failed = await runContextCommand(dir, "echo out; echo broken >&2; exit 3", 10_000, lease);
  expect(failed).toMatchObject({ exitCode: 3, output: "out\nbroken", truncated: false });
  expect(held).toBe(0);
  await expect(runContextCommand(dir, "   ", 10_000, lease)).rejects.toThrow("Type a command");
});
