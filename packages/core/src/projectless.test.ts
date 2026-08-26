import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allocateThreadFolder,
  defaultProjectlessFolder,
  isInboxProject,
  slugForTask,
} from "./projectless.js";

describe("projectless task folder", () => {
  it("defaults to Documents/Capsule under the home directory", () => {
    expect(defaultProjectlessFolder("/Users/ada")).toBe("/Users/ada/Documents/Capsule");
  });

  it("treats Inbox as the projectless container", () => {
    expect(isInboxProject({ name: "Inbox" })).toBe(true);
    expect(isInboxProject({ name: "API Workspace" })).toBe(false);
  });

  it("creates a dated thread folder and avoids collisions", () => {
    const root = mkdtempSync(path.join(tmpdir(), "capsule-projectless-"));
    const now = new Date("2026-08-26T12:00:00");
    const first = allocateThreadFolder(root, "Review this repo", now);
    expect(first).toBe(path.join(root, "2026-08-26", "review-this-repo"));
    expect(existsSync(first)).toBe(true);
    mkdirSync(path.join(root, "2026-08-26", "review-this-repo"), { recursive: true });
    const second = allocateThreadFolder(root, "Review this repo", now);
    expect(second).toBe(path.join(root, "2026-08-26", "review-this-repo-2"));
    expect(slugForTask("What should we work on?")).toBe("what-should-we-work-on");
  });
});
