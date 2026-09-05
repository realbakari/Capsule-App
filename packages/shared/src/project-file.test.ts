import { describe, expect, it } from "vitest";

import {
  isSharedAction,
  mergeProjectActions,
  projectActionOverrides,
  parseProjectFile,
  PROJECT_FILE_NAME,
} from "./project-file.js";

it("saves local additions without pinning shared commands to an old copy", () => {
  const shared = { id: "file:test", name: "Tests", command: "pnpm test" };
  const local = { id: "check", name: "Build", command: "pnpm build" };
  const saved = projectActionOverrides([shared], [shared, local]);
  expect(saved).toEqual([local]);
  const updated = { ...shared, command: "pnpm test --run" };
  expect(mergeProjectActions([updated], saved)).toEqual([updated, local]);
  const override = { ...shared, openPreview: false };
  expect(projectActionOverrides([shared], [override, local])).toEqual([override, local]);
});

describe("parseProjectFile", () => {
  it("reads what a repository declares", () => {
    const state = parseProjectFile(
      JSON.stringify({
        iconPath: "assets/logo.svg",
        defaultWorkspaceMode: "worktree",
        actions: [
          { name: "Dev server", command: "pnpm dev", previewUrl: "localhost:5173" },
          { name: "Setup", command: "pnpm install", runOnWorktreeCreate: true },
        ],
      }),
    );
    expect(state.status).toBe("ok");
    if (state.status !== "ok") return;
    expect(state.file.iconPath).toBe("assets/logo.svg");
    expect(state.file.defaultWorkspaceMode).toBe("worktree");
    expect(state.file.actions.map((action) => action.name)).toEqual(["Dev server", "Setup"]);
    expect(state.file.actions[1]?.runOnWorktreeCreate).toBe(true);
  });

  it("gives an action the same id on every machine", () => {
    // Derived from the name, not generated: a random id would make one action
    // per clone of the repository.
    const first = parseProjectFile(JSON.stringify({ actions: [{ name: "Dev server", command: "x" }] }));
    const second = parseProjectFile(JSON.stringify({ actions: [{ name: "Dev server", command: "x" }] }));
    expect(first.status === "ok" && first.file.actions[0]?.id).toBe("file:dev-server");
    expect(second.status === "ok" && second.file.actions[0]?.id).toBe("file:dev-server");
  });

  it("says what is wrong instead of going quiet", () => {
    expect(parseProjectFile("{ not json").status).toBe("invalid");
    expect(parseProjectFile("[]").status).toBe("invalid");
    const mode = parseProjectFile(JSON.stringify({ defaultWorkspaceMode: "cloud" }));
    expect(mode.status === "invalid" && mode.error).toContain("defaultWorkspaceMode");
    const actions = parseProjectFile(JSON.stringify({ actions: "pnpm dev" }));
    expect(actions.status === "invalid" && actions.error).toContain("actions");
  });

  it("skips an entry that is not an action rather than failing the file", () => {
    const state = parseProjectFile(
      JSON.stringify({ actions: [{ name: "Fine", command: "ls" }, { name: "No command" }, 7] }),
    );
    expect(state.status === "ok" && state.file.actions.map((a) => a.name)).toEqual(["Fine"]);
  });

  it("bounds what a file can declare", () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      name: `Action ${index}`,
      command: "ls",
    }));
    const state = parseProjectFile(JSON.stringify({ actions: many }));
    expect(state.status === "ok" && state.file.actions.length).toBe(50);
  });

  it("has one name for the file", () => {
    expect(PROJECT_FILE_NAME).toBe("capsule.json");
  });
});

describe("mergeProjectActions", () => {
  const shared = { id: "file:dev", name: "Dev", command: "pnpm dev" };
  const mine = { id: "action-1", name: "Mine", command: "ls" };

  it("puts the repository's first", () => {
    expect(mergeProjectActions([shared], [mine]).map((a) => a.id)).toEqual(["file:dev", "action-1"]);
  });

  it("lets a local action of the same id win", () => {
    const override = { ...shared, command: "pnpm dev --port 4000" };
    expect(mergeProjectActions([shared], [override])).toEqual([override]);
  });

  it("knows which is which", () => {
    expect(isSharedAction(shared)).toBe(true);
    expect(isSharedAction(mine)).toBe(false);
  });
});
