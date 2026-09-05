import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { FolderActivity, foldersOverlap } from "./folder-activity.js";

it("excludes restore from active work, including aliases, with idempotent release", () => {
  const root = mkdtempSync(path.join(tmpdir(), "capsule-folder-lock-"));
  const alias = `${root}-alias`;
  try {
    symlinkSync(root, alias);
    const locks = new FolderActivity();
    const first = locks.enter(root);
    const second = locks.enter(alias);
    first(); first();
    expect(() => locks.restore(root)).toThrow("still active");
    second();
    const restored = locks.restore(root);
    expect(() => locks.enter(alias)).toThrow("being restored");
    expect(() => locks.assertAvailable(alias)).toThrow("being restored");
    expect(() => locks.restore(alias)).toThrow("being restored");
    restored();
    expect(() => locks.enter(alias)()).not.toThrow();
  } finally { rmSync(alias, { force: true }); rmSync(root, { recursive: true, force: true }); }
});

it("excludes nested project writers without confusing sibling path prefixes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "capsule-nested-lock-"));
  try {
    const nested = path.join(root, "nested");
    const locks = new FolderActivity();
    const working = locks.enter(nested);
    expect(() => locks.restore(root)).toThrow("still active");
    working();
    const restoring = locks.restore(nested);
    expect(() => locks.enter(root)).toThrow("being restored");
    expect(() => locks.enter(path.join(root, "nested-sibling"))()).not.toThrow();
    expect(foldersOverlap(root, `${root}-sibling`)).toBe(false);
    restoring();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
