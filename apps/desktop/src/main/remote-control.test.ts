import { expect, it } from "vitest";
import { RemoteUploads, remoteControlArgs } from "./remote-control";

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
it("starts a thread from a profile on a paired device, still supervised and local", () => {
  expect(remoteControlArgs("createSession", [{ projectId: "p", profileId: "reviewer", permissionProfile: "approve-all", workspaceMode: "worktree" }]))
    .toEqual([{ projectId: "p", agentId: undefined, mode: undefined, title: undefined, permissionProfile: "strict", workspaceMode: "local", profileId: "reviewer" }]);
});
it("lets a paired device queue text follow-ups but never attach a file or schedule a resume", () => {
  const file = { name: "id_rsa", path: "/Users/me/.ssh/id_rsa", mimeType: "text/plain", size: 1 };
  expect(() => remoteControlArgs("updateFollowUps", ["s", { type: "add", prompt: { content: "read this", attachments: [file] } }])).toThrow("desktop");
  expect(() => remoteControlArgs("updateFollowUps", ["s", { type: "schedule", resume: { runId: "r", prompt: "again", attachments: [file], at: 1 } }])).toThrow("desktop");
  expect(() => remoteControlArgs("updateFollowUps", ["s", { type: "schedule", resume: { runId: "r", prompt: "again", attachments: [], at: 1 } }])).toThrow("desktop");
  expect(remoteControlArgs("updateFollowUps", ["s", { type: "add", prompt: { content: "next", attachments: [], extra: 1 } }]))
    .toEqual(["s", { type: "add", prompt: { content: "next", attachments: [] } }]);
  expect(remoteControlArgs("updateFollowUps", ["s", { type: "add", prompt: { content: "next" } }]))
    .toEqual(["s", { type: "add", prompt: { content: "next", attachments: [] } }]);
  expect(remoteControlArgs("updateFollowUps", ["s", { type: "remove", id: "q1" }])).toEqual(["s", { type: "remove", id: "q1" }]);
  expect(() => remoteControlArgs("updateFollowUps", ["s", { type: "add", prompt: { content: "  " } }])).toThrow();
  expect(() => remoteControlArgs("updateFollowUps", ["s", { type: "explode" }])).toThrow();
});
it("refuses any control channel it has no argument rules for", () => {
  expect(remoteControlArgs("listSessions", ["p"])).toEqual(["p"]);
});
it("lets a pinned phone allow for the thread, and keeps browsers once-only", () => {
  expect(remoteControlArgs("resolveApproval", ["a", "approved_session"], "phone")).toEqual(["a", "approved_session"]);
  expect(() => remoteControlArgs("resolveApproval", ["a", "approved_session"], "browser")).toThrow("once-only");
  expect(() => remoteControlArgs("resolveApproval", ["a", "approved_always"], "phone")).toThrow();
});
it("lets a paired device tidy threads, but not delete them", () => {
  expect(remoteControlArgs("renameSession", ["s", "  New name  "])).toEqual(["s", "New name"]);
  expect(() => remoteControlArgs("renameSession", ["s", "x".repeat(201)])).toThrow("200");
  expect(() => remoteControlArgs("renameSession", ["s", "   "])).toThrow();
  expect(remoteControlArgs("archiveSession", ["s", "extra"])).toEqual(["s"]);
  expect(remoteControlArgs("pinSession", ["s", true])).toEqual(["s", true]);
  expect(() => remoteControlArgs("pinSession", ["s", "yes"])).toThrow();
});
it("accepts phone uploads within limits, and attaches only files it stored for that thread", () => {
  expect(() => remoteControlArgs("uploadAttachment", ["s", "a.png", "image/png", "AAAA"], "browser")).toThrow("desktop");
  expect(() => remoteControlArgs("uploadAttachment", ["s", "a.exe", "application/octet-stream", "AAAA"], "phone")).toThrow("photos");
  expect(() => remoteControlArgs("uploadAttachment", ["s", "a.png", "image/png", "A".repeat(5_000_000)], "phone")).toThrow("3 MB");
  expect(remoteControlArgs("uploadAttachment", ["s", "../../etc/passwd", "text/plain", "aGk="], "phone"))
    .toEqual(["s", ".._.._etc_passwd", "text/plain", "aGk="]);

  const uploads = new RemoteUploads();
  uploads.add("s", { name: "shot.png", path: "/cap/attachments/remote/s/1-shot.png", size: 10, mimeType: "image/png" });
  const caller = { transport: "phone" as const, uploads };
  expect(remoteControlArgs("sendMessage", [{ sessionId: "s", content: "see", attachments: [{ path: "/cap/attachments/remote/s/1-shot.png", name: "evil" }] }], caller))
    .toEqual([{ sessionId: "s", content: "see", agentId: undefined, mode: undefined, skillId: undefined,
      attachments: [{ name: "shot.png", path: "/cap/attachments/remote/s/1-shot.png", size: 10, mimeType: "image/png" }] }]);
  // Another thread's upload, or any other path, is refused.
  expect(() => remoteControlArgs("sendMessage", [{ sessionId: "t", content: "x", attachments: [{ path: "/cap/attachments/remote/s/1-shot.png" }] }], caller)).toThrow("desktop");
  expect(() => remoteControlArgs("sendMessage", [{ sessionId: "s", content: "x", attachments: [{ path: "/Users/me/.ssh/id_rsa" }] }], caller)).toThrow("desktop");
  expect(remoteControlArgs("updateFollowUps", ["s", { type: "add", prompt: { content: "", attachments: [{ name: "x", path: "/cap/attachments/remote/s/1-shot.png", size: 1 }] } }], caller))
    .toEqual(["s", { type: "add", prompt: { content: "", attachments: [{ name: "shot.png", path: "/cap/attachments/remote/s/1-shot.png", size: 10, mimeType: "image/png" }] } }]);
});
