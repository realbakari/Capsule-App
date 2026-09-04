import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Run } from "@capsule/shared";
import { TurnVerification } from "./TurnVerification";

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../../lib/workspace", () => ({ useWorkspace: () => context.value }));
const run: Run = { id: "r", sessionId: "s", projectId: "p", agentId: "general", status: "completed", prompt: "work", createdAt: "2026-09-04T00:00:00Z", updatedAt: "2026-09-04T00:00:00Z" };
beforeEach(() => { context.value = { api: {}, projects: [{ id: "p", actions: [{ id: "test", name: "Test", command: "test-command" }] }], settings: {} }; });
it("starts collapsed, does not claim success, and explains missing evidence", () => {
  const html = renderToStaticMarkup(createElement(TurnVerification, { run }));
  expect(html).toContain("Not verified"); expect(html).toContain("No saved revision"); expect(html).not.toContain("<details open");
  expect(html).toMatch(/disabled=""[^>]*>Run selected check/);
});
it("uses actions from the owning project and explains the local-only boundary", () => {
  context.value.projects = [{ id: "other", actions: [{ id: "wrong", name: "Wrong project", command: "wrong" }] }];
  const html = renderToStaticMarkup(createElement(TurnVerification, { run }));
  expect(html).not.toContain("Wrong project"); expect(html).toContain("project is no longer available"); expect(html).toContain("do not certify remote agent files");
  expect(html).not.toContain("Add check");
});

it("offers to save a check without unusable run or recheck buttons when no actions exist", () => {
  context.value.projects = [{ id: "p", actions: [] }];
  const html = renderToStaticMarkup(createElement(TurnVerification, { run }));
  expect(html).toContain("Add check");
  expect(html).not.toContain("Run selected check");
  expect(html).not.toContain("Recheck evidence");
  expect(html).toContain("Tool activity alone does not verify the result");
  expect(html).toContain('class="verification-details"><summary>Evidence details');
});

it("selects a sole saved action without executing it and uses styled controls", () => {
  const html = renderToStaticMarkup(createElement(TurnVerification, { run: { ...run, revision: { cwd: "/repo", tree: "tree", head: null } } }));
  expect(html).toContain('value="test" selected=""');
  expect(html).toContain('class="send">Run selected check');
  expect(html).not.toContain("Recheck evidence");
});
it("hides verification for failed and active turns", () => {
  expect(renderToStaticMarkup(createElement(TurnVerification, { run: { ...run, status: "failed" } }))).toBe("");
});

it("keeps a running check cancellable after remounting the turn", () => {
  const html = renderToStaticMarkup(createElement(TurnVerification, { run: { ...run, verification: {
    id: "v", runId: run.id, passed: false, status: "unverified", inProgress: true, summary: "Checking", checks: [], createdAt: run.createdAt,
  } } }));
  expect(html).toContain("Cancel check"); expect(html).not.toContain("Run selected check");
});
