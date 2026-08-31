import os from "node:os";
import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type FilePreview,
  type FileReadResult,
  type MessagePage,
  type PopupMenuRequest,
} from "@capsule/shared";

const api = {
  /* Resolved once at preload time so path display can abbreviate the home
     directory without an IPC round trip on every render. */
  homeDir: os.homedir(),
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listProjects),
  createProject: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.createProject, input),
  getProject: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.getProject, id),
  listAgents: () => ipcRenderer.invoke(IPC_CHANNELS.listAgents),
  listSkills: () => ipcRenderer.invoke(IPC_CHANNELS.listSkills),
  listSkillPacks: () => ipcRenderer.invoke(IPC_CHANNELS.listSkillPacks),
  installSkill: (skill: unknown) => ipcRenderer.invoke(IPC_CHANNELS.installSkill, skill),
  installSkillPack: (packId: string) => ipcRenderer.invoke(IPC_CHANNELS.installSkillPack, packId),
  uninstallSkill: (skillId: string) => ipcRenderer.invoke(IPC_CHANNELS.uninstallSkill, skillId),
  searchSkillsSh: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.searchSkillsSh, query),
  fetchSkillDetail: (source: string, slug: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.fetchSkillDetail, source, slug),
  listSessions: (projectId?: string) => ipcRenderer.invoke(IPC_CHANNELS.listSessions, projectId),
  createSession: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.createSession, input),
  renameSession: (id: string, title: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameSession, id, title),
  archiveSession: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.archiveSession, id),
  deleteSession: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteSession, id),
  listMessages: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.listMessages, sessionId),
  listMessagePage: (
    sessionId: string,
    options?: { limit?: number; before?: { createdAt: string; id: string } },
  ): Promise<MessagePage> => ipcRenderer.invoke(IPC_CHANNELS.listMessagePage, sessionId, options),
  sendMessage: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.sendMessage, input),
  startRun: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.startRun, input),
  stopRun: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.stopRun, id),
  getRun: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.getRun, id),
  listRuns: (sessionId?: string) => ipcRenderer.invoke(IPC_CHANNELS.listRuns, sessionId),
  listRunEvents: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.listRunEvents, runId),
  verifyRun: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.verifyRun, runId),
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
    options?: { origin?: "user" | "agent"; expectedRevision?: string; root?: string },
  ) => ipcRenderer.invoke(IPC_CHANNELS.writeFile, projectId, relative, content, options),
  listFiles: (projectId: string, relative?: string, root?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listFiles, projectId, relative, root),
  openTerminal: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.openTerminal, projectId),
  execInProject: (projectId: string, command: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.execInProject, projectId, command),
  getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getStatus),
  getSubsystemStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getSubsystemStatus),
  connectGateway: (url?: string) => ipcRenderer.invoke(IPC_CHANNELS.connectGateway, url),
  disconnectGateway: () => ipcRenderer.invoke(IPC_CHANNELS.disconnectGateway),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  updateSettings: (patch: unknown) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch),
  getDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.getDiagnostics),
  search: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.search, query),
  updateProject: (id: string, patch: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateProject, id, patch),
  deleteProject: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteProject, id),
  gitStatus: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.gitStatus, projectId),
  gitDiff: (projectId: string, relative?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitDiff, projectId, relative),
  checkoutBranch: (projectId: string, branch: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkoutBranch, projectId, branch),
  gitCommit: (projectId: string, message: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitCommit, projectId, message),
  gitStage: (projectId: string, relative: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitStage, projectId, relative),
  gitDiscard: (projectId: string, relative: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitDiscard, projectId, relative),
  gitCreateBranch: (projectId: string, branch: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitCreateBranch, projectId, branch),
  gitPush: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.gitPush, projectId),
  gitCreatePullRequest: (
    projectId: string,
    input?: { title?: string; body?: string; sessionId?: string },
  ) => ipcRenderer.invoke(IPC_CHANNELS.gitCreatePullRequest, projectId, input),
  gitMergePullRequest: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitMergePullRequest, projectId),
  searchContents: (projectId: string, query: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchContents, projectId, query),
  openPath: (target: string) => ipcRenderer.invoke(IPC_CHANNELS.openPath, target),
  pickDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.pickDirectory),
  pickFiles: () => ipcRenderer.invoke(IPC_CHANNELS.pickFiles),
  listHarnesses: () => ipcRenderer.invoke(IPC_CHANNELS.listHarnesses),
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
  listHarnessSessions: (projectId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listHarnessSessions, projectId),
  pinSession: (id: string, pinned: boolean) => ipcRenderer.invoke(IPC_CHANNELS.pinSession, id, pinned),
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
