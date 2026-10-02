import { expect, it } from "vitest";
import { remoteControlArgs } from "./remote-control";

it("creates supervised local threads, never trusting a requested cwd or elevated permissions", () => {
  expect(remoteControlArgs("createSession", [{ projectId: "p", mode: "code", agentId: "codex", title: "Task", workingDirectory: "/", permissionProfile: "approve-all", workspaceMode: "worktree" }]))
    .toEqual([{ projectId: "p", agentId: "codex", mode: "code", title: "Task", permissionProfile: "strict", workspaceMode: "local" }]);
});
it("allows text and once-only decisions, but rejects file paths and permanent approvals", () => {
  expect(remoteControlArgs("sendMessage", [{ sessionId: "s", content: "Hello", attachments: [], extra: "ignored" }]))
    .toEqual([{ sessionId: "s", content: "Hello", agentId: undefined, mode: undefined, skillId: undefined }]);
  expect(() => remoteControlArgs("sendMessage", [{ sessionId: "s", content: "Hello", attachments: [{ path: "/private" }] }])).toThrow("desktop");
  expect(remoteControlArgs("resolveApproval", ["a", "approved_once"])).toEqual(["a", "approved_once"]);
  expect(() => remoteControlArgs("resolveApproval", ["a", "approved_session"])).toThrow("once-only");
});
