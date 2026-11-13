import { describe, expect, it } from "vitest";

import { IPC_CHANNELS, IPC_EVENTS } from "./ipc.js";
import { isChannelAllowed, isRemoteEvent, READ_ONLY_CHANNELS, scopeForChannel } from "./ipc-scopes.js";

describe("ipc scopes", () => {
  it("limits conversation control to named operations, never administration", () => {
    for (const channel of ["sendMessage", "createSession", "stopRun", "resolveApproval", "listSessions"]) expect(isChannelAllowed(channel, ["control"])).toBe(true);
    for (const channel of ["terminalStart", "updateSettings", "remotePair", "remoteRevoke", "writeFile", "restoreSession", "connectRelay", "analyticsStatus", "constructor"]) expect(isChannelAllowed(channel, ["control"])).toBe(false);
  });
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
      "relayStatus",
      "connectRelay",
      "disconnectRelay",
      "rememberRelay",
      "forgetRelay",
      "channelAvatar",
      "sharedChannelDetails",
      "updateSharedChannel",
      "manageSharedChannel",
      "channelReactions",
      "reactToChannelMessage",
      "listSharedChannels",
      "createSharedChannel",
      "channelMembership",
      "channelMembers",
      "inviteChannelMember",
      "removeChannelMember",
      "channelMessages",
      "postChannelMessage",
      "channelRouteStatus",
      "configureChannelRoute",
      "listSavedChannelRoutes",
      "removeChannelRoute",
      "runChannelHarness",
      "listChannelHarnessJobs",
      "shareChannelHarnessReply",
      "terminalStart",
      "terminalInput",
      "terminalAcknowledge",
      "clearBrowserData",
      "copyBrowserScreenshot",
      "listSimulators",
      "listSimulatorApps",
      "simulatorScreen",
      "simulatorAction",
      "readSimulatorSettings",
      "attachSimulator",
      "rewindSession",
      "updateFollowUps",
      "saveTextAttachment",
      "saveImageAttachment",
      "registerBrowserView",
      "setBrowserControl",
      "controlBackgroundBrowser",
      "inspectBackgroundBrowser",
      "setHarnessConfig",
      "discoverHarness",
      "execInProject",
      "runProjectAction",
      "verifyRun",
      "cancelVerification",
      "writeFile",
      "pickDirectory",
      "spawnHarness",
      "gitCommit",
      "gitPush",
      "gitMergePullRequestStack",
      "gitRebasePullRequestStack",
      "updateSettings",
      "deleteProject",
      "resolveApproval",
      "togglePet",
      "getPetVoiceStatus",
      "listenPetCommand",
      "finishPetCommand",
      "cancelPetVoice",
      "speakPetStatus",
      "setPetExpanded",
    ]) {
      expect(scopeForChannel(channel)).toBe("write");
      expect(isChannelAllowed(channel, ["read"])).toBe(false);
    }
  });

  it("lets a viewer read a conversation", () => {
    for (const channel of [
      "listSessions",
      "readSharedBrowser",
      "listMessagePage",
      "gitDiff",
      "getPullRequest",
      "getCommitDiff",
      "listRunEvents",
      "providerUsage",
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

describe("remote events", () => {
  it("keeps shell output on this machine", () => {
    expect(isRemoteEvent(IPC_EVENTS.terminalData)).toBe(false);
    expect(isRemoteEvent(IPC_EVENTS.terminalExit)).toBe(false);
  });

  it("forwards conversation state", () => {
    for (const event of [IPC_EVENTS.state, IPC_EVENTS.run, IPC_EVENTS.message, IPC_EVENTS.approval]) {
      expect(isRemoteEvent(event)).toBe(true);
    }
  });
});

describe("follow-up channels", () => {
  it("lets a viewer read the queue and conversation control change it, but not a read-only device", () => {
    expect(isChannelAllowed("getFollowUps", ["read"])).toBe(true);
    expect(isChannelAllowed("updateFollowUps", ["read"])).toBe(false);
    expect(isChannelAllowed("updateFollowUps", ["control"])).toBe(true);
  });
});
