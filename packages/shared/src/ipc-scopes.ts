import { IPC_CHANNELS } from "./ipc.js";

/**
 * What a paired client is allowed to do.
 *
 * A viewer reads: transcripts, diffs, run history, status. Everything that
 * changes the machine — sending a prompt, starting a shell, running a project
 * action, writing a file, picking a folder — is a separate scope, because a
 * peer holding "read" must not be one flag away from a remote shell.
 */
export type IpcScope = "read" | "write";

type ChannelName = keyof typeof IPC_CHANNELS;

/**
 * Every channel a read-only viewer may call. The list is explicit rather than
 * derived from a naming convention: `getDiagnostics` reads, `getSettings`
 * reads, and `checkForUpdates` reaches the network — a rule based on the word
 * "get" would have been wrong three ways.
 */
const READ_CHANNELS: ChannelName[] = [
  "listProjects",
  "getProject",
  "listAgents",
  "listSkills",
  "listSkillFiles",
  "previewSkillFile",
  "listSessions",
  "listMessages",
  "listMessagePage",
  "getRun",
  "listRuns",
  "listRunEvents",
  "listArtifacts",
  "listApprovals",
  "readFile",
  "readFileVersioned",
  "previewFile",
  "listFiles",
  "listProjectActionRuns",
  "getStatus",
  "getSubsystemStatus",
  "getSettings",
  "getDiagnostics",
  // Unlike checkForUpdates, this only reports what is already known: no
  // network call, no check started, nothing downloaded.
  "updateStatus",
  "search",
  "searchContents",
  "searchFiles",
  "gitStatus",
  "gitDiff",
  "listPullRequests",
  "getPullRequest",
  "listLocalServers",
  "listHarnesses",
  "harnessStatus",
  "listHarnessSessions",
  "listSkillPacks",
  "processMetrics",
  "processHistory",
  "hostState",
  "sourceControlTools",
  "usageSummary",
  "turnDiff",
  "rendererReady",
  "windowBackground",
];

const READ_SET = new Set<string>(READ_CHANNELS);

/** The scope a channel needs. Anything not named above is a write. */
export function scopeForChannel(channel: string): IpcScope {
  return READ_SET.has(channel) ? "read" : "write";
}

/** Whether a client holding these scopes may call this channel. */
export function isChannelAllowed(channel: string, scopes: readonly IpcScope[]): boolean {
  const required = scopeForChannel(channel);
  return required === "read" ? scopes.includes("read") || scopes.includes("write") : scopes.includes("write");
}

export const READ_ONLY_CHANNELS: readonly string[] = READ_CHANNELS;
