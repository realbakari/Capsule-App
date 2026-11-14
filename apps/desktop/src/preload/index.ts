import os from "node:os";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type FilePreview,
  type FileReadResult,
  type OpenInCatalog,
  type MessagePage,
  type PopupMenuRequest,
  type ProviderUsageSnapshot,
} from "@capsule/shared";

const api = {
  isDesktop: true,
  relayStatus: (): Promise<import("@capsule/shared").RelayConnectionStatus> => ipcRenderer.invoke(IPC_CHANNELS.relayStatus),
  connectRelay: (input: import("@capsule/shared").RelayConnectionInput): Promise<import("@capsule/shared").RelayConnectionStatus> => ipcRenderer.invoke(IPC_CHANNELS.connectRelay, input),
  disconnectRelay: (): Promise<import("@capsule/shared").RelayConnectionStatus> => ipcRenderer.invoke(IPC_CHANNELS.disconnectRelay),
  rememberRelay: (): Promise<import("@capsule/shared").RelayConnectionStatus> => ipcRenderer.invoke(IPC_CHANNELS.rememberRelay),
  forgetRelay: (): Promise<import("@capsule/shared").RelayConnectionStatus> => ipcRenderer.invoke(IPC_CHANNELS.forgetRelay),
  channelAvatar: (pubkey: string): Promise<string | undefined> => ipcRenderer.invoke(IPC_CHANNELS.channelAvatar, pubkey),
  sharedChannelDetails: (channel: string, name: string): Promise<import("@capsule/shared").SharedChannelDetails | undefined> => ipcRenderer.invoke(IPC_CHANNELS.sharedChannelDetails, channel, name),
  updateSharedChannel: (input: import("@capsule/shared").ChannelUpdate): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.updateSharedChannel, input),
  manageSharedChannel: (channel: string, action: import("@capsule/shared").ChannelManagementAction): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.manageSharedChannel, channel, action),
  channelReactions: (message: string): Promise<import("@capsule/shared").ChannelReaction[]> => ipcRenderer.invoke(IPC_CHANNELS.channelReactions, message),
  reactToChannelMessage: (message: string, emoji: string, action: "add" | "remove"): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.reactToChannelMessage, message, emoji, action),
  listSharedChannels: (): Promise<import("@capsule/shared").SharedChannel[]> => ipcRenderer.invoke(IPC_CHANNELS.listSharedChannels),
  createSharedChannel: (input: import("@capsule/shared").NewSharedChannel): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.createSharedChannel, input),
  channelMembership: (channel: string, action: "join" | "leave"): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.channelMembership, channel, action),
  channelMembers: (channel: string): Promise<import("@capsule/shared").ChannelMember[]> => ipcRenderer.invoke(IPC_CHANNELS.channelMembers, channel),
  inviteChannelMember: (input: import("@capsule/shared").ChannelInvitation): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.inviteChannelMember, input),
  removeChannelMember: (channel: string, pubkey: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.removeChannelMember, channel, pubkey),
  channelMessages: (channel: string, parent?: string): Promise<import("@capsule/shared").ChannelMessage[]> => ipcRenderer.invoke(IPC_CHANNELS.channelMessages, channel, parent),
  postChannelMessage: (input: import("@capsule/shared").ChannelPost): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.postChannelMessage, input),
  channelRouteStatus: (channelId: string): Promise<import("@capsule/shared").ChannelRouteStatus> => ipcRenderer.invoke(IPC_CHANNELS.channelRouteStatus, channelId),
  configureChannelRoute: (input: import("@capsule/shared").ChannelRouteInput): Promise<import("@capsule/shared").ChannelRouteStatus> => ipcRenderer.invoke(IPC_CHANNELS.configureChannelRoute, input),
  listSavedChannelRoutes: (): Promise<import("@capsule/shared").SavedChannelRoute[]> => ipcRenderer.invoke(IPC_CHANNELS.listSavedChannelRoutes),
  removeChannelRoute: (id: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.removeChannelRoute, id),
  runChannelHarness: (input: import("@capsule/shared").ChannelHarnessInput): Promise<import("@capsule/shared").ChannelHarnessJob> => ipcRenderer.invoke(IPC_CHANNELS.runChannelHarness, input),
  listChannelHarnessJobs: (channelId: string, messageId?: string): Promise<import("@capsule/shared").ChannelHarnessJob[]> => ipcRenderer.invoke(IPC_CHANNELS.listChannelHarnessJobs, channelId, messageId),
  shareChannelHarnessReply: (id: string, content: string): Promise<import("@capsule/shared").ChannelHarnessJob> => ipcRenderer.invoke(IPC_CHANNELS.shareChannelHarnessReply, id, content),
  /* Resolved once at preload time so path display can abbreviate the home
     directory without an IPC round trip on every render. */
  homeDir: os.homedir(),
  platform: process.platform as NodeJS.Platform,
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listProjects),
  createProject: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.createProject, input),
  cloneRepository: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.cloneRepository, input),
  getProject: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.getProject, id),
  listAgents: () => ipcRenderer.invoke(IPC_CHANNELS.listAgents),
  listSkills: (projectId?: string, sessionId?: string) => ipcRenderer.invoke(IPC_CHANNELS.listSkills, projectId, sessionId),
  listSkillFiles: (skillId: string, relative = ".", projectId?: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listSkillFiles, skillId, relative, projectId, sessionId),
  previewSkillFile: (skillId: string, relative: string, projectId?: string, sessionId?: string): Promise<FilePreview> =>
    ipcRenderer.invoke(IPC_CHANNELS.previewSkillFile, skillId, relative, projectId, sessionId),
  listSkillPacks: () => ipcRenderer.invoke(IPC_CHANNELS.listSkillPacks),
  installSkill: (skill: unknown) => ipcRenderer.invoke(IPC_CHANNELS.installSkill, skill),
  installSkillPack: (packId: string) => ipcRenderer.invoke(IPC_CHANNELS.installSkillPack, packId),
  uninstallSkill: (skillId: string) => ipcRenderer.invoke(IPC_CHANNELS.uninstallSkill, skillId),
  searchSkillCatalog: (query: string, refresh?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchSkillCatalog, query, refresh),
  resetSettingsSection: (section: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.resetSettingsSection, section),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  updateStatus: () => ipcRenderer.invoke(IPC_CHANNELS.updateStatus),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.installUpdate),
  processMetrics: () => ipcRenderer.invoke(IPC_CHANNELS.processMetrics),
  hostState: () => ipcRenderer.invoke(IPC_CHANNELS.hostState),
  sourceControlTools: () => ipcRenderer.invoke(IPC_CHANNELS.sourceControlTools),
  usageSummary: (days: number) => ipcRenderer.invoke(IPC_CHANNELS.usageSummary, days),
  providerUsage: (): Promise<ProviderUsageSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.providerUsage),
  turnDiff: (runId: string, options?: import("@capsule/shared").TurnDiffOptions): Promise<import("@capsule/shared").TurnDiffResult> => ipcRenderer.invoke(IPC_CHANNELS.turnDiff, runId, options),
  rewindSession: (sessionId: string, messageId: string, options?: { restoreFiles?: boolean }): Promise<import("@capsule/shared").RestoreResult> => ipcRenderer.invoke(IPC_CHANNELS.rewindSession, sessionId, messageId, options),
  restoreToTurn: (request: import("@capsule/shared").RestoreRequest): Promise<import("@capsule/shared").RestoreResult> => ipcRenderer.invoke(IPC_CHANNELS.restoreToTurn, request),
  redoRestore: (sessionId: string): Promise<import("@capsule/shared").RestoreResult> => ipcRenderer.invoke(IPC_CHANNELS.redoRestore, sessionId),
  redoPoint: (sessionId: string): Promise<import("@capsule/shared").RedoPoint | null> => ipcRenderer.invoke(IPC_CHANNELS.redoPoint, sessionId),
  compareCheckpoint: (runId: string, options?: import("@capsule/shared").TurnDiffOptions): Promise<import("@capsule/shared").TurnDiffResult> => ipcRenderer.invoke(IPC_CHANNELS.compareCheckpoint, runId, options),
  forkSession: (input: import("@capsule/shared").ForkSessionInput): Promise<import("@capsule/shared").Session> => ipcRenderer.invoke(IPC_CHANNELS.forkSession, input),
  forkBranches: (sessionId: string): Promise<import("@capsule/shared").ForkBranchGroup[]> => ipcRenderer.invoke(IPC_CHANNELS.forkBranches, sessionId),
  listImportableSessions: (projectId: string): Promise<import("@capsule/shared").ImportListing> => ipcRenderer.invoke(IPC_CHANNELS.listImportableSessions, projectId),
  importSession: (input: import("@capsule/shared").ImportSessionInput): Promise<import("@capsule/shared").Session> => ipcRenderer.invoke(IPC_CHANNELS.importSession, input),
  handoffDraft: (sessionId: string): Promise<{ summary: string }> => ipcRenderer.invoke(IPC_CHANNELS.handoffDraft, sessionId),
  handoffSession: (input: import("@capsule/shared").HandoffInput): Promise<import("@capsule/shared").Session> => ipcRenderer.invoke(IPC_CHANNELS.handoffSession, input),
  worktreeApplyStatus: (sessionId: string): Promise<import("@capsule/shared").WorktreeApplyStatus> => ipcRenderer.invoke(IPC_CHANNELS.worktreeApplyStatus, sessionId),
  applyWorktreeToLocal: (sessionId: string): Promise<import("@capsule/shared").ApplyResult> => ipcRenderer.invoke(IPC_CHANNELS.applyWorktreeToLocal, sessionId),
  undoApplyToLocal: (sessionId: string, undoRef: string): Promise<{ ok: boolean; detail: string; files: string[] }> => ipcRenderer.invoke(IPC_CHANNELS.undoApplyToLocal, sessionId, undoRef),
  getFollowUps: (sessionId: string): Promise<import("@capsule/shared").FollowUps> => ipcRenderer.invoke(IPC_CHANNELS.getFollowUps, sessionId),
  updateFollowUps: (sessionId: string, op: import("@capsule/shared").FollowUpOp): Promise<import("@capsule/shared").FollowUps> => ipcRenderer.invoke(IPC_CHANNELS.updateFollowUps, sessionId, op),
  createBoardCard: (input: import("@capsule/shared").CreateBoardCardInput): Promise<import("@capsule/shared").Session> => ipcRenderer.invoke(IPC_CHANNELS.createBoardCard, input),
  updateBoardCard: (sessionId: string, op: import("@capsule/shared").BoardCardOp): Promise<import("@capsule/shared").Session> => ipcRenderer.invoke(IPC_CHANNELS.updateBoardCard, sessionId, op),
  fetchSkillDetail: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.fetchSkillDetail, id),
  startBestOfN: (input: import("@capsule/shared").StartBestOfNInput): Promise<import("@capsule/shared").StartBestOfNResult> => ipcRenderer.invoke(IPC_CHANNELS.startBestOfN, input),
  listThreadGroups: (): Promise<import("@capsule/shared").ThreadGroup[]> => ipcRenderer.invoke(IPC_CHANNELS.listThreadGroups),
  compareThreadGroup: (groupId: string): Promise<import("@capsule/shared").GroupComparison> => ipcRenderer.invoke(IPC_CHANNELS.compareThreadGroup, groupId),
  keepCandidate: (groupId: string, sessionId: string): Promise<import("@capsule/shared").ApplyResult> => ipcRenderer.invoke(IPC_CHANNELS.keepCandidate, groupId, sessionId),
  setAsideCandidates: (groupId: string): Promise<{ archived: string[]; failed: Array<{ sessionId: string; reason: string }> }> => ipcRenderer.invoke(IPC_CHANNELS.setAsideCandidates, groupId),
  rateRun: (runId: string, value: import("@capsule/shared").RatingValue | 0): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.rateRun, runId, value),
  runRatings: (sessionId: string): Promise<Record<string, import("@capsule/shared").RatingValue>> => ipcRenderer.invoke(IPC_CHANNELS.runRatings, sessionId),
  resultsLeaderboard: (): Promise<import("@capsule/shared").LeaderboardRow[]> => ipcRenderer.invoke(IPC_CHANNELS.resultsLeaderboard),
  listWorktreeBases: (projectId: string): Promise<import("@capsule/shared").WorktreeBases> =>
    ipcRenderer.invoke(IPC_CHANNELS.listWorktreeBases, projectId),
  setSessionWorktreeBase: (sessionId: string, ref: string): Promise<import("@capsule/shared").Session> =>
    ipcRenderer.invoke(IPC_CHANNELS.setSessionWorktreeBase, sessionId, ref),
  startPullRequestThread: (input: import("@capsule/shared").StartPullRequestInput): Promise<{ session: import("@capsule/shared").Session; draft: string; detail: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.startPullRequestThread, input),
  listSessions: (projectId?: string) => ipcRenderer.invoke(IPC_CHANNELS.listSessions, projectId),
  createSession: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.createSession, input),
  setSessionWorkspaceMode: (id: string, mode: "local" | "worktree") =>
    ipcRenderer.invoke(IPC_CHANNELS.setSessionWorkspaceMode, id, mode),
  renameSession: (id: string, title: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameSession, id, title),
  setSessionTurnMode: (id: string, mode: import("@capsule/shared").TurnMode): Promise<{ session: import("@capsule/shared").Session; detail?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.setSessionTurnMode, id, mode),
  archiveSession: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.archiveSession, id),
  restoreSession: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.restoreSession, id),
  deleteSession: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteSession, id),
  listMessages: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.listMessages, sessionId),
  messageImage: (messageId: string, index: number): Promise<string | undefined> => ipcRenderer.invoke(IPC_CHANNELS.messageImage, messageId, index),
  listMessagePage: (
    sessionId: string,
    options?: { limit?: number; before?: { createdAt: string; id: string; }; },
  ): Promise<MessagePage> => ipcRenderer.invoke(IPC_CHANNELS.listMessagePage, sessionId, options),
  sendMessage: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.sendMessage, input),
  startRun: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.startRun, input),
  stopRun: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.stopRun, id),
  getRun: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.getRun, id),
  listRuns: (sessionId?: string) => ipcRenderer.invoke(IPC_CHANNELS.listRuns, sessionId),
  listRunPage: (query?: import("@capsule/shared").RunHistoryQuery): Promise<import("@capsule/shared").RunHistoryPage> => ipcRenderer.invoke(IPC_CHANNELS.listRunPage, query),
  listLatestRuns: (): Promise<import("@capsule/shared").Run[]> => ipcRenderer.invoke(IPC_CHANNELS.listLatestRuns),
  listRunEvents: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.listRunEvents, runId),
  listRunEventPage: (runId: string, before?: import("@capsule/shared").RunEventCursor): Promise<import("@capsule/shared").RunEventPage> => ipcRenderer.invoke(IPC_CHANNELS.listRunEventPage, runId, before),
  verifyRun: (runId: string, actionId?: string) => ipcRenderer.invoke(IPC_CHANNELS.verifyRun, runId, actionId),
  cancelVerification: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.cancelVerification, runId),
  listArtifacts: (runId?: string) => ipcRenderer.invoke(IPC_CHANNELS.listArtifacts, runId),
  listApprovals: (status?: string) => ipcRenderer.invoke(IPC_CHANNELS.listApprovals, status),
  resolveApproval: (id: string, decision: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.resolveApproval, id, decision),
  readFile: (projectId: string, relative: string, root?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readFile, projectId, relative, root),
  readFileVersioned: (projectId: string, relative: string, root?: string): Promise<FileReadResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.readFileVersioned, projectId, relative, root),
  previewFile: (projectId: string, relative: string, root?: string): Promise<FilePreview> =>
    ipcRenderer.invoke(IPC_CHANNELS.previewFile, projectId, relative, root),
  writeFile: (
    projectId: string,
    relative: string,
    content: string,
    options?: { origin?: "user" | "agent"; expectedRevision?: string; root?: string; },
  ) => ipcRenderer.invoke(IPC_CHANNELS.writeFile, projectId, relative, content, options),
  listFiles: (projectId: string, relative?: string, root?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listFiles, projectId, relative, root),
  openTerminal: (projectId: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.openTerminal, projectId, sessionId),
  processHistory: () => ipcRenderer.invoke(IPC_CHANNELS.processHistory),
  rendererReady: (surface?: "pet") => ipcRenderer.invoke(IPC_CHANNELS.rendererReady, surface),
  remoteStatus: () => ipcRenderer.invoke(IPC_CHANNELS.remoteStatus),
  remoteMode: "desktop" as "desktop" | "read" | "control" | "connecting" | "share",
  remoteError: undefined as string | undefined,
  /* True in a browser opened from a share link: one thread, read only, nothing to disconnect. */
  remoteShare: false as boolean,
  remotePair: (access: "read" | "control" = "read") => ipcRenderer.invoke(IPC_CHANNELS.remotePair, access),
  analyticsStatus: (): Promise<{ enabled: boolean; configured: boolean; host: string; pending: number; lastSentAt?: string; error?: string }> => ipcRenderer.invoke(IPC_CHANNELS.analyticsStatus),
  remoteRevoke: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.remoteRevoke, id),
  threadMarkdown: (sessionId: string, options?: import("@capsule/shared").ThreadMarkdownOptions): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.threadMarkdown, sessionId, options),
  exportThreadMarkdown: (sessionId: string, options?: import("@capsule/shared").ThreadMarkdownOptions): Promise<{ saved: boolean; path?: string }> => ipcRenderer.invoke(IPC_CHANNELS.exportThreadMarkdown, sessionId, options),
  createShareLink: (sessionId: string, expiry: import("@capsule/shared").ShareLinkExpiry): Promise<import("@capsule/shared").CreatedShareLink> => ipcRenderer.invoke(IPC_CHANNELS.createShareLink, sessionId, expiry),
  listShareLinks: (sessionId?: string): Promise<import("@capsule/shared").ShareGrant[]> => ipcRenderer.invoke(IPC_CHANNELS.listShareLinks, sessionId),
  revokeShareLink: (id: string): Promise<import("@capsule/shared").ShareGrant | undefined> => ipcRenderer.invoke(IPC_CHANNELS.revokeShareLink, id),
  threadPresence: (): Promise<import("@capsule/shared").ThreadPresence[]> => ipcRenderer.invoke(IPC_CHANNELS.threadPresence),
  windowBackground: (color: string) => ipcRenderer.invoke(IPC_CHANNELS.windowBackground, color),
  terminalStart: (input: { cwd: string; cols?: number; rows?: number; }) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalStart, input),
  terminalInput: (id: string, data: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalInput, id, data),
  terminalAcknowledge: (id: string, sequence: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalAcknowledge, id, sequence),
  terminalResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalResize, id, cols, rows),
  terminalStop: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.terminalStop, id),
  runProjectAction: (projectId: string, actionId: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.runProjectAction, projectId, actionId, sessionId),
  stopProjectAction: (projectId: string, actionId: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.stopProjectAction, projectId, actionId, sessionId),
  listProjectActionRuns: (projectId: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listProjectActionRuns, projectId, sessionId),
  getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getStatus),
  getSubsystemStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getSubsystemStatus),
  connectGateway: (url?: string) => ipcRenderer.invoke(IPC_CHANNELS.connectGateway, url),
  disconnectGateway: () => ipcRenderer.invoke(IPC_CHANNELS.disconnectGateway),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  updateSettings: (patch: unknown) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch),
  getDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.getDiagnostics),
  configGetEffective: (projectId?: string): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.configGetEffective, projectId),
  configGetDiagnostics: (projectId?: string): Promise<import("@capsule/shared").ConfigDiagnostics> =>
    ipcRenderer.invoke(IPC_CHANNELS.configGetDiagnostics, projectId),
  configSetValue: (input: import("@capsule/shared").SetConfigValueInput): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.configSetValue, input),
  /** Creates the file or folder from a template when missing, opens it, and returns its path. */
  configOpenFile: (target: import("@capsule/shared").ConfigFileTarget): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.configOpenFile, target),
  configTrust: (projectId: string, trusted: boolean): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.configTrust, projectId, trusted),
  configReload: (projectId?: string): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.configReload, projectId),
  /** Adds or removes one permission rule in the user or project-local file. */
  configEditPermissionRule: (edit: import("@capsule/shared").PermissionRuleEdit): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.configEditPermissionRule, edit),
  commandsList: (projectId?: string): Promise<import("@capsule/shared").CommandList> =>
    ipcRenderer.invoke(IPC_CHANNELS.commandsList, projectId),
  /** Expands a command for editing in the composer. It may run the command's shell spans. */
  commandsExpand: (input: import("@capsule/shared").CommandExpandInput): Promise<import("@capsule/shared").CommandExpansion> =>
    ipcRenderer.invoke(IPC_CHANNELS.commandsExpand, input),
  /** Quits and starts again, with or without customizations. Running turns may hold the quit. */
  appRestart: (input: { safeMode: boolean }): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.appRestart, input),
  themesImport: (input: import("@capsule/shared").ThemeImportInput): Promise<import("@capsule/shared").ThemeImportResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.themesImport, input),
  keybindingsSet: (edit: import("@capsule/shared").KeybindingEdit): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.keybindingsSet, edit),
  mcpTest: (input: import("@capsule/shared").McpTestInput): Promise<import("@capsule/shared").McpTestResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.mcpTest, input),
  mcpSetEnabled: (input: import("@capsule/shared").McpEnabledInput): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.mcpSetEnabled, input),
  profilesCreate: (input: import("@capsule/shared").ProfileCreateInput): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.profilesCreate, input),
  statusLineRun: (input: import("@capsule/shared").StatusLineRequest): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.statusLineRun, input),
  automationsRunNow: (input: import("@capsule/shared").AutomationKeyInput): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.automationsRunNow, input),
  automationsSetEnabled: (input: import("@capsule/shared").AutomationEnabledInput): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.automationsSetEnabled, input),
  automationsDismissMissed: (input: import("@capsule/shared").AutomationKeyInput): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.automationsDismissMissed, input),
  automationsCreate: (input: import("@capsule/shared").AutomationCreateInput): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.automationsCreate, input),
  sessionsMarkRead: (sessionId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.sessionsMarkRead, sessionId),
  /** Copies or fetches a plugin and lists exactly what it adds. Folders and zips are picked here in main; undefined when the pick is cancelled. */
  pluginsInspect: (input: import("@capsule/shared").PluginsInspectInput): Promise<import("@capsule/shared").PluginInspection | undefined> =>
    ipcRenderer.invoke(IPC_CHANNELS.pluginsInspect, input),
  pluginsInstall: (input: import("@capsule/shared").PluginsInstallInput): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.pluginsInstall, input),
  pluginsDiscard: (token: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.pluginsDiscard, token),
  pluginsSetEnabled: (input: { name: string; enabled: boolean }): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.pluginsSetEnabled, input),
  pluginsConfigure: (input: import("@capsule/shared").PluginsConfigureInput): Promise<import("@capsule/shared").ConfigSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.pluginsConfigure, input),
  pluginsUninstall: (name: string): Promise<import("@capsule/shared").ConfigSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.pluginsUninstall, name),
  backdropChooseImage: (): Promise<import("@capsule/shared").ConfigSnapshot | undefined> => ipcRenderer.invoke(IPC_CHANNELS.backdropChooseImage),
  search: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.search, query),
  updateProject: (id: string, patch: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateProject, id, patch),
  deleteProject: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteProject, id),
  gitStatus: (projectId: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitStatus, projectId, sessionId),
  listPullRequests: (projectId: string, sessionId?: string, refresh = false) =>
    ipcRenderer.invoke(IPC_CHANNELS.listPullRequests, projectId, sessionId, refresh),
  getPullRequest: (projectId: string, number: number, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getPullRequest, projectId, number, sessionId),
  getCommitDiff: (projectId: string, oid: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getCommitDiff, projectId, oid, sessionId),
  gitInit: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.gitInit, projectId),
  gitDiff: (projectId: string, relative?: string, sessionId?: string, options?: import("@capsule/shared").GitDiffOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitDiff, projectId, relative, sessionId, options),
  checkoutBranch: (projectId: string, branch: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkoutBranch, projectId, branch, sessionId),
  gitCommit: (projectId: string, message: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitCommit, projectId, message, sessionId),
  gitStage: (projectId: string, relative: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitStage, projectId, relative, sessionId),
  gitDiscard: (projectId: string, relative: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitDiscard, projectId, relative, sessionId),
  gitScopedDiff: (projectId: string, scope: import("@capsule/shared").GitDiffScope, relative?: string, sessionId?: string, options?: import("@capsule/shared").GitDiffOptions): Promise<import("@capsule/shared").ScopedDiff> =>
    ipcRenderer.invoke(IPC_CHANNELS.gitScopedDiff, projectId, scope, relative, sessionId, options),
  gitCheckHunks: (projectId: string, applies: import("@capsule/shared").HunkApply[], sessionId?: string): Promise<boolean[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.gitCheckHunks, projectId, applies, sessionId),
  gitApplyHunk: (projectId: string, apply: import("@capsule/shared").HunkApply, sessionId?: string): Promise<import("@capsule/shared").GitStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.gitApplyHunk, projectId, apply, sessionId),
  gitCreateBranch: (projectId: string, branch: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitCreateBranch, projectId, branch, sessionId),
  gitPush: (projectId: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitPush, projectId, sessionId),
  gitCreatePullRequest: (
    projectId: string,
    input?: { title?: string; body?: string; sessionId?: string; },
  ) => ipcRenderer.invoke(IPC_CHANNELS.gitCreatePullRequest, projectId, input),
  gitMergePullRequest: (projectId: string, sessionId?: string, target?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitMergePullRequest, projectId, sessionId, target),
  gitMergePullRequestStack: (projectId: string, action: unknown, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitMergePullRequestStack, projectId, action, sessionId),
  gitRebasePullRequestStack: (projectId: string, action: unknown, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitRebasePullRequestStack, projectId, action, sessionId),
  searchContents: (projectId: string, query: string, sessionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchContents, projectId, query, sessionId),
  listLocalServers: () => ipcRenderer.invoke(IPC_CHANNELS.listLocalServers),
  listSimulators: (): Promise<import("@capsule/shared").SimulatorInventory> => ipcRenderer.invoke(IPC_CHANNELS.listSimulators),
  listSimulatorApps: (udid: string): Promise<import("@capsule/shared").SimulatorApp[]> => ipcRenderer.invoke(IPC_CHANNELS.listSimulatorApps, udid),
  simulatorScreen: (udid: string): Promise<import("@capsule/shared").SimulatorFrame> => ipcRenderer.invoke(IPC_CHANNELS.simulatorScreen, udid),
  simulatorAction: (udid: string, action: import("@capsule/shared").SimulatorAction): Promise<import("@capsule/shared").SimulatorActionResult | undefined> => ipcRenderer.invoke(IPC_CHANNELS.simulatorAction, udid, action),
  readSimulatorSettings: (udid: string): Promise<import("@capsule/shared").SimulatorDeviceSettings> => ipcRenderer.invoke(IPC_CHANNELS.readSimulatorSettings, udid),
  attachSimulator: (threadId: string, udid: string | undefined): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.attachSimulator, threadId, udid),
  openPath: (target: string) => ipcRenderer.invoke(IPC_CHANNELS.openPath, target),
  listOpenInApps: (projectId?: string, sessionId?: string, target?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listOpenInApps, projectId, sessionId, target) as Promise<OpenInCatalog>,
  addOpenInApp: () => ipcRenderer.invoke(IPC_CHANNELS.addOpenInApp) as Promise<string | undefined>,
  openInApp: (appId: string, projectId: string, sessionId?: string, target?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.openInApp, appId, projectId, sessionId, target) as Promise<void>,
  pickDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.pickDirectory),
  pickFiles: () => ipcRenderer.invoke(IPC_CHANNELS.pickFiles),
  saveClipboardImage: () => ipcRenderer.invoke(IPC_CHANNELS.saveClipboardImage),
  saveImageAttachment: (png: Uint8Array): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.saveImageAttachment, png),
  saveTextAttachment: (text: string, name?: string): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.saveTextAttachment, text, name),
  fetchUrlContext: (url: string): Promise<import("@capsule/shared").UrlContext> => ipcRenderer.invoke(IPC_CHANNELS.fetchUrlContext, url),
  runComposerCommand: (projectId: string, command: string, sessionId?: string): Promise<import("@capsule/shared").CommandResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.runComposerCommand, projectId, command, sessionId),
  runDiagnostics: (projectId: string, sessionId?: string): Promise<import("@capsule/shared").DiagnosticsResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.runDiagnostics, projectId, sessionId),
  registerBrowserView: (webContentsId: number | undefined, threadId?: string, ready?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.registerBrowserView, webContentsId, threadId, ready),
  setBrowserControl: (threadId: string, allowed: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setBrowserControl, threadId, allowed),
  clearBrowserData: (webContentsId: number, kind: "cache" | "storage") =>
    ipcRenderer.invoke(IPC_CHANNELS.clearBrowserData, webContentsId, kind),
  captureBrowserElement: (webContentsId: number, rect: { x: number; y: number; width: number; height: number }): Promise<string | undefined> =>
    ipcRenderer.invoke(IPC_CHANNELS.captureBrowserElement, webContentsId, rect),
  emulateBrowserDevice: (webContentsId: number, device: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.emulateBrowserDevice, webContentsId, device),
  copyBrowserScreenshot: (webContentsId: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.copyBrowserScreenshot, webContentsId),
  togglePet: (visible?: boolean) => ipcRenderer.invoke(IPC_CHANNELS.togglePet, visible),
  getPetVoiceStatus: (): Promise<import("@capsule/shared").PetVoiceStatus> => ipcRenderer.invoke(IPC_CHANNELS.getPetVoiceStatus),
  listenPetCommand: (): Promise<string | undefined> => ipcRenderer.invoke(IPC_CHANNELS.listenPetCommand),
  finishPetCommand: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.finishPetCommand),
  cancelPetVoice: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.cancelPetVoice),
  speakPetStatus: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.speakPetStatus),
  startDictation: (): Promise<import("@capsule/shared").DictationOutcome> => ipcRenderer.invoke(IPC_CHANNELS.startDictation),
  finishDictation: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.finishDictation),
  cancelDictation: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.cancelDictation),
  openDictationSettings: (pane: import("@capsule/shared").DictationSettingsPane): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.openDictationSettings, pane),
  getPetState: (): Promise<{ visible: boolean; summary: import("@capsule/shared").AttentionSummary }> => ipcRenderer.invoke(IPC_CHANNELS.getPetState),
  setPetExpanded: (expanded: boolean) => ipcRenderer.invoke(IPC_CHANNELS.setPetExpanded, expanded),
  focusSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.focusSession, sessionId),
  validateAttachments: (attachments: Array<{ name: string; path: string; }>) =>
    ipcRenderer.invoke(IPC_CHANNELS.validateAttachments, attachments),
  listHarnesses: () => ipcRenderer.invoke(IPC_CHANNELS.listHarnesses),
  discoverHarness: (projectId: string, harnessId: string, model?: string, sessionId?: string): Promise<import("@capsule/shared").HarnessDiscovery> => ipcRenderer.invoke(IPC_CHANNELS.discoverHarness, projectId, harnessId, model, sessionId),
  doctorHarness: (harnessId: string) => ipcRenderer.invoke(IPC_CHANNELS.doctorHarness, harnessId),
  dedicateHarness: (projectId: string, harnessId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.dedicateHarness, projectId, harnessId),
  undedicateHarness: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.undedicateHarness, projectId),
  spawnHarness: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.spawnHarness, input),
  cancelHarness: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.cancelHarness, sessionId),
  steerHarness: (sessionId: string, instruction: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.steerHarness, sessionId, instruction),
  closeHarness: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.closeHarness, sessionId),
  harnessStatus: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.harnessStatus, sessionId),
  setHarnessOption: (patch: unknown) => ipcRenderer.invoke(IPC_CHANNELS.setHarnessOption, patch),
  controlBackgroundBrowser: (owner: string, command: import("@capsule/shared").BackgroundBrowserCommand) => ipcRenderer.invoke(IPC_CHANNELS.controlBackgroundBrowser, owner, command),
  inspectBackgroundBrowser: (owner: string) => ipcRenderer.invoke(IPC_CHANNELS.inspectBackgroundBrowser, owner),
  readSharedBrowser: (owner: string) => ipcRenderer.invoke(IPC_CHANNELS.readSharedBrowser, owner),
  setHarnessConfig: (sessionId: string, configId: string, value: string | boolean) => ipcRenderer.invoke(IPC_CHANNELS.setHarnessConfig, sessionId, configId, value),
  listHarnessSessions: (projectId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listHarnessSessions, projectId),
  pinSession: (id: string, pinned: boolean) => ipcRenderer.invoke(IPC_CHANNELS.pinSession, id, pinned),
  pauseSession: (id: string): Promise<import("@capsule/shared").Session> => ipcRenderer.invoke(IPC_CHANNELS.pauseSession, id),
  resumeSession: (id: string): Promise<{ session: import("@capsule/shared").Session; detail: string }> => ipcRenderer.invoke(IPC_CHANNELS.resumeSession, id),
  setSessionTags: (id: string, tags: string[]): Promise<import("@capsule/shared").Session> => ipcRenderer.invoke(IPC_CHANNELS.setSessionTags, id, tags),
  renameTag: (from: string, to: string): Promise<number> => ipcRenderer.invoke(IPC_CHANNELS.renameTag, from, to),
  deleteTag: (tag: string): Promise<number> => ipcRenderer.invoke(IPC_CHANNELS.deleteTag, tag),
  keepSession: (id: string): Promise<import("@capsule/shared").Session> => ipcRenderer.invoke(IPC_CHANNELS.keepSession, id),
  listGithubIssues: (projectId: string): Promise<{ items?: import("@capsule/shared").GithubIssue[]; error?: string }> => ipcRenderer.invoke(IPC_CHANNELS.listGithubIssues, projectId),
  answerAgentQuestion: (approvalId: string, answers: import("@capsule/shared").AgentQuestionAnswers): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.answerAgentQuestion, approvalId, answers),
  reorderProjects: (orderedIds: string[]) => ipcRenderer.invoke(IPC_CHANNELS.reorderProjects, orderedIds),
  triageSession: (id: string, action: import("@capsule/shared").ThreadTriageAction): Promise<import("@capsule/shared").Session> =>
    ipcRenderer.invoke(IPC_CHANNELS.triageSession, id, action),
  reorderPinnedSessions: (projectId: string, orderedIds: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.reorderPinnedSessions, projectId, orderedIds),
  searchFiles: (projectId: string, query?: string, root?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchFiles, projectId, query, root),
  regenerateTitle: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.regenerateTitle, id),
  setPermissionProfile: (id: string, profile: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.setPermissionProfile, id, profile),
  showContextMenu: (request: PopupMenuRequest): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.showContextMenu, request),
  on: (channel: keyof typeof IPC_EVENTS, handler: (payload: unknown) => void) => {
    const name = IPC_EVENTS[channel];
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => handler(payload);
    ipcRenderer.on(name, listener);
    return () => ipcRenderer.removeListener(name, listener);
  },
};

contextBridge.exposeInMainWorld("capsule", api);

export type CapsuleApi = typeof api;
