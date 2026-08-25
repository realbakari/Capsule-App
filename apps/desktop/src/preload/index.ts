import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, IPC_EVENTS } from "@capsule/shared";

const api = {
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listProjects),
  createProject: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.createProject, input),
  getProject: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.getProject, id),
  listAgents: () => ipcRenderer.invoke(IPC_CHANNELS.listAgents),
  listSkills: () => ipcRenderer.invoke(IPC_CHANNELS.listSkills),
  listSessions: (projectId?: string) => ipcRenderer.invoke(IPC_CHANNELS.listSessions, projectId),
  createSession: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.createSession, input),
  renameSession: (id: string, title: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameSession, id, title),
  archiveSession: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.archiveSession, id),
  deleteSession: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteSession, id),
  listMessages: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.listMessages, sessionId),
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
  readFile: (projectId: string, relative: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.readFile, projectId, relative),
  writeFile: (projectId: string, relative: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeFile, projectId, relative, content),
  listFiles: (projectId: string, relative?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listFiles, projectId, relative),
  openTerminal: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.openTerminal, projectId),
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
  searchContents: (projectId: string, query: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchContents, projectId, query),
  openPath: (target: string) => ipcRenderer.invoke(IPC_CHANNELS.openPath, target),
  pickDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.pickDirectory),
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
  searchFiles: (projectId: string, query?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchFiles, projectId, query),
  regenerateTitle: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.regenerateTitle, id),
  setPermissionProfile: (id: string, profile: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.setPermissionProfile, id, profile),
  on: (channel: keyof typeof IPC_EVENTS, handler: (payload: unknown) => void) => {
    const name = IPC_EVENTS[channel];
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => handler(payload);
    ipcRenderer.on(name, listener);
    return () => ipcRenderer.removeListener(name, listener);
  },
};

contextBridge.exposeInMainWorld("capsule", api);

export type CapsuleApi = typeof api;
