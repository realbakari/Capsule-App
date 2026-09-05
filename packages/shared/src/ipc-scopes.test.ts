import { describe, expect, it } from "vitest";

import { IPC_CHANNELS } from "./ipc.js";
import { isChannelAllowed, READ_ONLY_CHANNELS, scopeForChannel } from "./ipc-scopes.js";

describe("ipc scopes", () => {
  it("classifies every channel, so a new one cannot arrive unscoped", () => {
    for (const channel of Object.keys(IPC_CHANNELS)) {
      expect(["read", "write"]).toContain(scopeForChannel(channel));
    }
  });

  it("defaults an unknown channel to write", () => {
    // A channel added tomorrow is a write until someone decides otherwise:
    // the failure has to be a viewer that cannot do something, never a viewer
    // that can do everything.
    expect(scopeForChannel("capsule:somethingNew")).toBe("write");
  });

  it("keeps the machine out of a viewer's reach", () => {
    for (const channel of [
      "sendMessage",
      "terminalStart",
      "terminalInput",
      "clearBrowserData",
      "registerBrowserView",
      "execInProject",
      "runProjectAction",
      "verifyRun",
      "cancelVerification",
      "writeFile",
      "pickDirectory",
      "spawnHarness",
      "gitCommit",
      "gitPush",
      "updateSettings",
      "deleteProject",
      "resolveApproval",
    ]) {
      expect(scopeForChannel(channel)).toBe("write");
      expect(isChannelAllowed(channel, ["read"])).toBe(false);
    }
  });

  it("lets a viewer read a conversation", () => {
    for (const channel of [
      "listSessions",
      "listMessagePage",
      "gitDiff",
      "getPullRequest",
      "getCommitDiff",
      "listRunEvents",
    ]) {
      expect(isChannelAllowed(channel, ["read"])).toBe(true);
    }
  });

  it("gives a write scope the read channels too", () => {
    expect(isChannelAllowed("listSessions", ["write"])).toBe(true);
  });

  it("names only channels that exist", () => {
    for (const channel of READ_ONLY_CHANNELS) {
      expect(Object.keys(IPC_CHANNELS)).toContain(channel);
    }
  });
});
