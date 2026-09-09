import { expect, it } from "vitest";
import { resolveWorkspaceSelection } from "./workspace-selection";

const projects = [{ id: "first" }, { id: "second" }];
const sessions = [
  { id: "archived", projectId: "first", state: "archived" as const },
  { id: "active", projectId: "first", state: "active" as const },
  { id: "other", projectId: "second", state: "active" as const },
];

it("restores an existing project and its selected thread", () => {
  expect(resolveWorkspaceSelection(projects, sessions, "second", "other"))
    .toEqual({ projectId: "second", sessionId: "other" });
});

it("recovers deleted navigation hints from the authoritative workspace", () => {
  expect(resolveWorkspaceSelection(projects, sessions, "deleted", "missing"))
    .toEqual({ projectId: "first", sessionId: "active" });
});

it("does not carry another project's thread into scoped reads", () => {
  expect(resolveWorkspaceSelection(projects, sessions, "first", "other"))
    .toEqual({ projectId: "first", sessionId: "active" });
});

it("clears a missing thread when no active fallback exists", () => {
  expect(resolveWorkspaceSelection(projects, sessions.slice(0, 1), "first", "missing"))
    .toEqual({ projectId: "first", sessionId: undefined });
});

it("keeps explicitly opened archived history readable", () => {
  expect(resolveWorkspaceSelection(projects, sessions, "first", "archived"))
    .toEqual({ projectId: "first", sessionId: "archived" });
});

it("supports first launch and an empty workspace without retaining invalid ids", () => {
  expect(resolveWorkspaceSelection(projects, sessions))
    .toEqual({ projectId: "first", sessionId: "active" });
  expect(resolveWorkspaceSelection([], sessions, "deleted", "other")).toEqual({});
});
