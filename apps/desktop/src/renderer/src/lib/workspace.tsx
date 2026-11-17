import { applyAppearance } from "./appearance";
import { CYCLE_FAVORITE_MODEL_EVENT, useFavoriteModels, useTurnMode } from "./turn-mode";
import { ACT_ON_PLAN_PROMPT, agentEnabled, type TurnMode } from "@capsule/shared";
import { RequestScope } from "./request-scope";
import { resolveWorkspaceSelection } from "./workspace-selection";
import { HarnessStatusCache, harnessStatusIdentity } from "./harness-status-cache";
import { batchRunFrames, mergeMessagePage, mergeRunEvents, mergeRuns } from "./run-updates";
import { boundTranscript, retainRunReceipts } from "./transcript-window";
import { boundRunEvents, compactRunEvent, runEventBytes, LIVE_EVENT_LIMIT, LIVE_EVENT_BYTES, summarizeRun } from "@capsule/shared";
import { useScopedState } from "./scoped-state";
import { SteeringDrafts } from "./steering-drafts";
import { DraftRecovery } from "./draft-recovery";
import { fileMentionTarget, parentFolder } from "./file-context";
import { activityFromEvents, type RunActivity } from "./activity";
import { useCommandList, type CommandListState } from "./commands";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { canSteerTurn, harnessDisplayName } from "./harness";
import {
  addFolderToProject,
  folderBasename,
  projectActionOverrides,
  makePrimaryFolder as promoteProjectFolder,
  removeFolderFromProject,
  type Agent,
  type AgentMode,
  type ApprovalRequest,
  type Artifact,
  type CapsuleSettings,
  type CloneRepositoryInput,
  type ChatMessage,
  type FileEntry,
  type GitStatus,
  type GitCommitScope,
  type GitPullMode,
  type GitPullRequestStackAction,
  type HarnessDoctorReport,
  type HarnessLiveStatus,
  type HarnessPermissionProfile,
  type HarnessStatus,
  type MessageAttachment,
  type ResolvedContext,
  EMPTY_FOLLOW_UPS,
  type FollowUpOp,
  type FollowUps,
  type ScheduledResume,
  type Project,
  type ProjectAction,
  type Run,
  type RunEvent,
  type RuntimeStatus,
  type Session,
  type Skill,
  type SkillCatalogPage,
  type SubsystemStatus,
  type WorkspaceMode,
  type HunkApply,
  type StartPullRequestInput,
} from "@capsule/shared";

import { jumpCommandIndex, parseKeymapAction, type ConfigDiagnostics, type ConfigSnapshot, type EffectiveBinding, type KeyChord, type SetConfigValueInput } from "@capsule/shared";
import type { SettingsSectionId } from "../features/settings/settings-search";
import { TOGGLE_DICTATION_EVENT } from "./dictation";
import { fromProjectFile, projectSettingsFor } from "./config-view";
import { effectiveKeymap, INSERT_COMMAND_EVENT, KEY_COMMAND_EVENT } from "./keybindings";
import { useKeymap } from "./use-keymap";
import { clearedBackdrop } from "../features/customization/customization-commands";
import { adjacentSession, sidebarOrder } from "./session-cycle";
import { restoredPinOrder } from "./sidebar";
import { isNarrow } from "./narrow";
import { setDisplayPrefs } from "./display-prefs";
import { openComposerControl, type ComposerControl } from "./composer-controls";
import { OPEN_IN_EVENT, SHOW_SHORTCUTS_EVENT } from "./shortcuts-event";
import { formatUserError } from "./errors";
import { loadQueue, saveQueue, type QueuedPrompt } from "./prompt-queue";
import { EMPTY_NAVIGATION, canGoBack as navigationCanGoBack, canGoForward as navigationCanGoForward, goBack as navigationBack, goForward as navigationForward, pruneNavigation, recordNavigation, type NavigationHistory } from "./navigation-history";
import { contextUsageFromEvents, type ContextUsage } from "./context-window";
import { harnessPreflightReason } from "./harness-preflight";
import { useToasts } from "./toasts";
import { requestBrowserCommand } from "./browser-commands";
import { requestTerminalCommand } from "./terminal-requests";
import { rememberLastAction } from "./project-actions";
import { BROWSER_FIND_EVENT, FILES_FIND_EVENT } from "./browser-find";
import { requestLabel, withSlowNotice } from "./slow-requests";
import {
  promptDraftKey,
  readPromptStash,
  recoverFailedPrompt,
  stashPrompt,
  writePromptStash,
  type PromptStashEntry,
  type PromptDraft,
} from "./prompt-stash";

export type View =
  | "channels"
  | "chat"
  | "project"
  | "runtimes"
  | "skills"
  | "approvals"
  | "usage"
  | "settings"
  | "board";
export type InspectorTab =
  | "launcher"
  | "files"
  | "preview"
  | "changes"
  | "diff"
  | "run"
  | "agents"
  | "browser"
  | "simulator"
  | "compare";

const SIDEBAR_WIDTH_KEY = "capsule.sidebarWidth";
const SIDEBAR_COLLAPSED_KEY = "capsule.sidebarCollapsed";
const INSPECTOR_OPEN_KEY = "capsule.inspectorOpen";
const TERMINAL_OPEN_KEY = "capsule.terminalOpen";
const LAST_PROJECT_ID_KEY = "capsule.lastProjectId";
const LAST_SESSION_ID_KEY = "capsule.lastSessionId";
const DEFAULT_SIDEBAR_WIDTH = 264;

function storedFlag(key: string, fallback = false): boolean {
  try {
    const value = localStorage.getItem(key);
    if (value == null) return fallback;
    return value === "1";
  } catch {
    return fallback;
  }
}

function storedNumber(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export interface PendingResume {
  sessionId: string;
  /** The run that stopped on the limit, so the same stop is not scheduled twice. */
  runId: string;
  prompt: string;
  /** The stopped turn's files, so the resumed prompt is the same turn again. */
  attachments?: MessageAttachment[];
  at: number;
}

export interface ConfirmState {
  title: string;
  detail: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  /** A second way to say yes, for a choice such as "and restore files". */
  secondary?: { label: string; onConfirm: () => void };
}

/** How a new conversation starts, beyond its project and first prompt. */
export interface CreateTaskOptions {
  /** Held in memory only, on the shared checkout, until kept. */
  temporary?: boolean;
  title?: string;
  workspaceMode?: WorkspaceMode;
  /** The worktree branch's name before the branch prefix. */
  branchName?: string;
}

export interface WorkspaceValue {
  api: typeof window.capsule;
  view: View;
  setView: (view: View) => void;
  /** Which settings section is open. Lives here because the sidebar renders
      the settings nav while the panel renders the section's body. */
  settingsTab: SettingsSectionId;
  setSettingsTab: (tab: SettingsSectionId) => void;
  /** Reset one settings section to its defaults. */
  resetSettingsSection: (section: string) => Promise<void>;
  status?: RuntimeStatus;
  subsystems?: SubsystemStatus;
  projects: Project[];
  sessions: Session[];
  agents: Agent[];
  skills: Skill[];
  messages: ChatMessage[];
  historyLoad: { state: "loading" | "loaded" } | { state: "error"; detail: string };
  hasOlderMessages: boolean;
  loadingOlder: boolean;
  loadOlderMessages: () => Promise<void>;
  hasNewerMessages: boolean;
  returnToLatest: () => Promise<void>;
  /** Replace the open thread's messages and runs after turns were removed or put back. Merging would keep removed ones on screen. */
  reloadThread: (id: string) => Promise<void>;
  runs: Run[];
  events: RunEvent[];
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  /** Agents that are turned on. */
  harnesses: HarnessStatus[];
  /** Every agent, including ones turned off, for the Agents view. */
  allHarnesses: HarnessStatus[];
  harnessSessions: Session[];
  doctors: Partial<Record<string, HarnessDoctorReport>>;
  harnessStatuses: Partial<Record<string, HarnessLiveStatus>>;
  loadHarnessStatus: (sessionId: string) => Promise<void>;
  projectId?: string;
  sessionId?: string;
  agentId: string;
  mode: AgentMode;
  draft: string;
  attachments: MessageAttachment[];
  preparingAttachments: number;
  promptStashes: PromptStashEntry[];
  busy: boolean;
  sendBlockReason?: string;
  palette: boolean;
  paletteQuery: string;
  newProjectName: string;
  notice?: string;
  setNotice: (value: string | undefined) => void;
  steerDraft: string;
  project?: Project;
  session?: Session;
  activeRun?: Run;
  /** The first request waiting on the user; pendingApprovals holds all of them. */
  pendingApproval?: ApprovalRequest;
  /** Every approval or question waiting on the user in this workspace's runs. */
  pendingApprovals: ApprovalRequest[];
  connected: boolean;
  steps: RunActivity[];
  /** How full the harness's context window is, when it has said. */
  contextUsage?: ContextUsage;
  setProjectId: (id: string, nextSessionId?: string) => void;
  setSessionId: (id?: string) => void;
  setAgentId: (id: string) => void;
  setMode: (mode: AgentMode) => void;
  setDraft: (value: string | ((current: string) => string)) => void;
  pickAttachments: () => Promise<void>;
  attachClipboardImage: () => Promise<boolean>;
  /** Attach a PNG the app made, such as a simulator screenshot, to the message being written. */
  attachImage: (png: Uint8Array) => Promise<boolean>;
  attachPastedText: (text: string) => Promise<boolean>;
  attachFiles: (paths: string[]) => Promise<boolean>;
  /** Save composer context (a conversation, a diff, a page, a selection) and attach it with its chip. */
  attachContext: (resolved: ResolvedContext) => Promise<boolean>;
  /** Send a prompt the app wrote, such as `/init`, without touching the draft. */
  sendPrompt: (text: string) => Promise<boolean>;
  removeAttachment: (path: string) => void;
  stashCurrentPrompt: () => void;
  restorePromptStash: (id: string) => void;
  deletePromptStash: (id: string) => void;
  setPalette: (open: boolean) => void;
  setPaletteQuery: (value: string) => void;
  setNewProjectName: (value: string) => void;
  setSteerDraft: (value: string) => void;
  steeringPending: boolean;
  refresh: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  eventLoad?: { runId: string; state: "loading" | "loaded" | "error"; detail?: string };
  /** Start a conversation, in the given project or the selected one. */
  /** Opens a new conversation, in another project when one is named, optionally with a prompt waiting in its composer. */
  createTask: (projectId?: string, initialPrompt?: string, options?: CreateTaskOptions) => Promise<void>;
  /** Start a new conversation from an agent profile, in the open project or the one named. */
  startWithProfile: (profileId: string, projectId?: string) => Promise<void>;
  /** Visited conversations, like a browser's history. */
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  send: () => Promise<boolean>;
  /** Send the draft into the running turn as a steer, or queue it, whatever Settings says follow-ups do. */
  sendFollowUp: (how: "steer" | "queue") => Promise<boolean>;
  runAgentCommand: (name: string, input?: string) => Promise<boolean>;
  agentCommandsOpen: boolean;
  setAgentCommandsOpen: (open: boolean) => void;
  /** Capsule commands for the selected project, for the `/` menu, the palette and Settings. */
  commands: CommandListState;
  createProject: () => Promise<void>;
  git?: GitStatus;
  /** Why the last background status read failed. Shown in Conversation details, never in the thread. */
  gitError?: string;
  files: FileEntry[];
  confirm?: ConfirmState;
  setConfirm: (value?: ConfirmState) => void;
  pickProjectDirectory: (id?: string) => Promise<void>;
  pickFilesToMention: () => Promise<void>;
  createProjectFromFolder: () => Promise<void>;
  cloneRepository: (input: CloneRepositoryInput) => Promise<void>;
  addProjectFolder: (projectId?: string) => Promise<void>;
  removeProjectFolder: (path: string, projectId?: string) => Promise<void>;
  makePrimaryFolder: (path: string, projectId?: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => void;
  /** Resolves false when the title was empty or could not be saved; either way the person is told. */
  renameSession: (id: string, title: string) => Promise<boolean>;
  deleteSession: (id: string) => void;
  archiveSession: (id: string) => Promise<void>;
  restoreSession: (id: string) => Promise<void>;
  openTerminal: () => Promise<void>;
  initializeGit: () => Promise<void>;
  saveProjectActions: (actions: ProjectAction[]) => Promise<{ saved: true } | { saved: false; error: string }>;
  /** Runs a project action in the terminal dock and remembers it as this project's one-click action. */
  runProjectAction: (action: ProjectAction) => void;
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: (mode: WorkspaceMode) => Promise<void>;
  /** Move a not-yet-started worktree thread to another base branch. */
  setWorktreeBase: (ref: string) => Promise<void>;
  /** Check a pull request out and open a thread on it with a draft that names it. Throws on failure. */
  startPullRequestThread: (input: Omit<StartPullRequestInput, "projectId">) => Promise<{ detail: string }>;
  browserUrl: string;
  setBrowserUrl: (url: string) => void;
  projectRuns: Run[];
  openPath: (target: string) => Promise<void>;
  mentionFile: (relative: string) => void;
  spawnHarness: (
    harnessId: string,
    prompt?: string,
    options?: { mode?: "persistent" | "oneshot"; },
  ) => Promise<void>;
  draftHarnessConfig: { model?: string; options: Record<string, string> };
  setDraftHarnessConfig: (config: { model?: string; options: Record<string, string> }) => void;
  /** Ask, Auto or Full for the conversation this draft will start; undefined uses the Settings default. */
  draftApproval?: HarnessPermissionProfile;
  setDraftApproval: (profile: HarnessPermissionProfile | undefined) => void;
  dedicateHarness: (harnessId: string) => Promise<void>;
  undedicateHarness: () => Promise<void>;
  doctorHarness: (harnessId: string) => Promise<void>;
  cancelHarness: (id?: string) => Promise<void>;
  steerHarness: () => Promise<void>;
  closeHarness: (id?: string) => Promise<void>;
  refreshHarnessStatus: (id?: string) => Promise<void>;
  setHarnessOption: (
    key: "model" | "permissions" | "cwd" | "mode" | "timeout",
    value: string,
    sessionId?: string,
  ) => Promise<void>;
  ready: boolean;
  startupError?: string;
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  terminalOpen: boolean;
  setTerminalOpen: (value: boolean) => void;
  sidebarWidth: number;
  setSidebarCollapsed: (value: boolean) => void;
  setInspectorOpen: (value: boolean) => void;
  setSidebarWidth: (value: number) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  stopRun: () => Promise<void>;
  /** End the agent of a turn that ignores Stop; the next message starts it again. */
  forceStopRun: (runId: string) => Promise<void>;
  stoppingRunIds: string[];
  skillId?: string;
  setSkillId: (id?: string) => void;
  filePicker: boolean;
  setFilePicker: (open: boolean) => void;
  pinSession: (id: string, pinned: boolean) => Promise<void>;
  reorderPinnedSessions: (projectId: string, orderedIds: string[]) => Promise<void>;
  regenerateTitle: (id: string) => Promise<void>;
  setPermissionProfile: (profile: string) => Promise<void>;
  sendAndContinue: () => Promise<void>;
  checkoutBranch: (branch: string) => Promise<void>;
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
  openInspector: (tab?: InspectorTab) => void;
  /** Opens a file from the transcript in the inspector's preview. */
  openFile: (path: string, root?: string) => void;
  /** The file the inspector has been asked to show, if any. */
  requestedFile?: { path: string; root?: string; projectId?: string; sessionId?: string };
  clearRequestedFile: () => void;
  contentSearch: boolean;
  /** Follow-ups waiting for the running turn to finish, in send order. */
  queue: QueuedPrompt[];
  /** Why the first follow-up could not be sent yet; it stays first and is retried. */
  followUpsBlocked?: string;
  removeQueued: (id: string) => void;
  moveQueued: (id: string, direction: "up" | "down") => void;
  /** Why the queue waits for the person after a turn that was stopped or did not finish. */
  followUpsHeld?: string;
  /** Let a held queue go; with an id, that follow-up goes first. */
  releaseQueued: (id?: string) => void;
  /** Open a queued follow-up in the composer to rewrite it where it stands in line. */
  editQueued: (id: string) => void;
  /** The queued follow-up open in the composer, if any. */
  queuedEdit?: { id: string };
  cancelQueuedEdit: () => void;
  /** Save the composer over the queued follow-up being edited. */
  saveQueuedEdit: () => Promise<boolean>;
  /** Send a queued follow-up now as a steer, where the route supports it. */
  steerQueued: (id: string) => Promise<void>;
  /** A prompt waiting for a usage limit to lift, then sent through the queue. */
  pendingResume?: PendingResume;
  scheduleResume: (runId: string, prompt: string, at: number) => void;
  cancelResume: () => void;
  /** Send a stopped turn's prompt again now. */
  /** Re-send a stopped turn's prompt; with its run, its attachments go too. */
  retryPrompt: (prompt: string, runId?: string) => void;
  /** The find bar over the current conversation. */
  threadFind: boolean;
  setThreadFind: (open: boolean | ((current: boolean) => boolean)) => void;
  /** What find starts with when a search hit opened it. */
  threadFindQuery: string;
  /** Opens a thread with find seeded, as a message search hit does. */
  findInThread: (projectId: string, sessionId: string, query: string) => void;
  /** The jump list of this conversation's prompts. */
  promptJump: boolean;
  setPromptJump: (open: boolean | ((current: boolean) => boolean)) => void;
  setContentSearch: (open: boolean) => void;
  /** Commits the index as staged by default, or the named paths. */
  gitCommit: (message: string, scope?: GitCommitScope) => Promise<boolean>;
  gitStage: (relative: string) => Promise<void>;
  gitDiscard: (relative: string) => void;
  /** Keep, Reject or Unstage a hunk. Throws git's reason when it no longer applies. */
  gitApplyHunk: (apply: HunkApply) => Promise<void>;
  gitCreateBranch: (branch: string) => Promise<boolean>;
  /** Pushing to the default branch needs `toDefaultBranch`, given only after the user confirms it. */
  gitPush: (options?: { toDefaultBranch?: boolean; }) => Promise<boolean>;
  gitPull: (mode?: GitPullMode) => Promise<boolean>;
  /** A throttled background fetch; quiet whatever happens. */
  gitFetch: () => Promise<void>;
  gitCreatePullRequest: (input?: { title?: string; body?: string; }) => Promise<boolean>;
  gitMergePullRequest: () => Promise<void>;
  gitMergePullRequestStack: (action: GitPullRequestStackAction) => Promise<boolean>;
  gitRebasePullRequestStack: (action: GitPullRequestStackAction) => Promise<boolean>;
  installSkill: (skill: Skill) => Promise<Skill>;
  uninstallSkill: (skillId: string) => Promise<void>;
  searchSkillCatalog: (query: string, refresh?: boolean) => Promise<SkillCatalogPage>;
  fetchSkillDetail: (id: string) => Promise<string | undefined>;
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;
  settings?: CapsuleSettings;
  updateSettings: (patch: Partial<CapsuleSettings>) => Promise<CapsuleSettings>;
  /** Plan or Act for the next turn of the selected thread, or of the thread a first message creates. */
  turnMode: TurnMode;
  setTurnMode: (mode: TurnMode) => Promise<boolean>;
  /** Switch to Act, apply the Act model, and ask the agent to implement the plan it just wrote. */
  actOnPlan: () => Promise<void>;
  /** Stay in Plan and return to the composer for another planning turn. */
  keepPlanning: () => Promise<void>;
  favoriteModels: string[];
  toggleFavoriteModel: (agentId: string, modelId: string) => Promise<CapsuleSettings>;
  /** The settings files' effective values and where each came from, for the selected project. */
  config?: ConfigSnapshot;
  /** What the customization doctor shows for the selected project: files, problems, trust and runs. */
  configDiagnostics?: ConfigDiagnostics;
  /** Settings for work in the selected project, its files over yours. New conversations start from these. */
  projectSettings?: CapsuleSettings;
  /** Write or remove one key in one settings file, then show the result. */
  setConfigValue: (input: SetConfigValueInput) => Promise<ConfigSnapshot>;
  /** The default shortcuts with keybindings.json laid over them. */
  keyBindings: EffectiveBinding[];
  /** The first chord of a sequence, while Capsule waits up to 1.5 s for the second. */
  keyChordPending?: KeyChord;
}

const workspaceContextSlot = globalThis as typeof globalThis & {
  __capsuleWorkspaceContext?: Context<WorkspaceValue | null>;
};
const WorkspaceContext =
  workspaceContextSlot.__capsuleWorkspaceContext ?? createContext<WorkspaceValue | null>(null);
workspaceContextSlot.__capsuleWorkspaceContext = WorkspaceContext;

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}

/** The agent host's answer when a cancel went unacknowledged. */
const UNCONFIRMED_STOP = /has not confirmed cancellation/i;

/** Files one message can carry. */
const MAX_ATTACHMENTS = 8;
const tooManyAttachments = (over: number) => `A message can carry up to ${MAX_ATTACHMENTS} files. Remove ${over} to add these.`;

/** Messages fetched per page; older pages load on demand. */
const MESSAGE_PAGE_SIZE = 60;

export function WorkspaceProvider({ children }: { children: ReactNode; }) {
  /* Set below, once toasts exist; the bridge is wrapped once and stays stable. */
  const slowNotice = useRef<(name: string, waiting: boolean) => void>(() => undefined);
  const api = useMemo(() => withSlowNotice(window.capsule, (name, waiting) => slowNotice.current(name, waiting)), []);
  const stoppingRuns = useRef(new Set<string>());
  const [stoppingRunIds, setStoppingRunIds] = useState<string[]>([]);
  const [view, setView] = useState<View>("chat");
  const [settingsTab, setSettingsTab] = useState<SettingsSectionId>("general");
  const [status, setStatus] = useState<RuntimeStatus>();
  const [subsystems, setSubsystems] = useState<SubsystemStatus>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const cycleSession = useRef<(step: 1 | -1) => void>(() => undefined);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [projectId, setProjectId] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(LAST_PROJECT_ID_KEY) || undefined;
    } catch {
      return undefined;
    }
  });
  const [sessionId, setSessionId] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(LAST_SESSION_ID_KEY) || undefined;
    } catch {
      return undefined;
    }
  });
  /*
   * Back and Forward over visited places: a conversation and the view it was
   * shown in, so Back from Settings or the board returns to the thread under
   * it. Changes are recorded by effect, so every way of moving counts; a move
   * made by Back or Forward itself is marked so it is not recorded again.
   */
  const [navigation, setNavigation] = useState<NavigationHistory>(EMPTY_NAVIGATION);
  const navigating = useRef(false);
  useEffect(() => {
    if (navigating.current) { navigating.current = false; return; }
    setNavigation((current) => recordNavigation(current, { projectId, sessionId, view }));
  }, [projectId, sessionId, view]);
  const travel = (direction: "back" | "forward") => {
    const move = direction === "back" ? navigationBack(navigation) : navigationForward(navigation);
    if (!move) return;
    navigating.current = true;
    setNavigation(move.history);
    if (move.entry.projectId) setProjectId(move.entry.projectId);
    setSessionId(move.entry.sessionId);
    setView(move.entry.view ?? "chat");
  };
  const goBack = () => travel("back");
  const goForward = () => travel("forward");
  /* The mouse's side buttons and a trackpad swipe arrive outside React; they read the latest history. */
  const travelLatest = useRef(travel);
  travelLatest.current = travel;
  useEffect(() => {
    const onMouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.type === "mouseup") travelLatest.current(event.button === 3 ? "back" : "forward");
    };
    const onState = (payload: unknown) => {
      const command = (payload as { command?: string } | undefined)?.command;
      if (command === "history-back" || command === "history-forward") travelLatest.current(command === "history-back" ? "back" : "forward");
    };
    window.addEventListener("mousedown", onMouse);
    window.addEventListener("mouseup", onMouse);
    const off = api.on("state", onState);
    return () => {
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("mouseup", onMouse);
      off();
    };
  }, [api]);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string>();
  const refreshError = useRef<{ scope: object; detail: string } | undefined>(undefined);
  const requests = useRef(new RequestScope()).current;
  const scope = requests.select(JSON.stringify([projectId, sessionId,
    projects.find((p) => p.id === projectId)?.workingDirectory,
    sessions.find((s) => s.id === sessionId && s.projectId === projectId)?.workingDirectory]));
  // Drafts belong to the thread, not its mutable folder configuration.
  const draftScopes = useRef(new RequestScope()).current;
  const draftScope = draftScopes.select(JSON.stringify([projectId, sessionId]));
  const [transcript, setTranscript] = useScopedState(scope, { messages: [] as ChatMessage[], olderEvicted: false, hasNewer: false });
  const messages = transcript.messages;
  const [historyLoad, setHistoryLoad] = useScopedState<WorkspaceValue["historyLoad"]>(scope, { state: "loading" });
  const historyWindow = useMemo(() => ({ edge: "newest" as "newest" | "oldest", detached: false }), [scope]);
  historyWindow.detached = transcript.hasNewer;
  const setMessages = useCallback((update: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])) => {
    const edge = historyWindow.edge;
    setTranscript((current) => {
      const next = typeof update === "function" ? update(current.messages) : update;
      const bounded = boundTranscript(next, edge);
      return {
        messages: bounded.messages,
        olderEvicted: current.olderEvicted || (bounded.trimmed && edge === "newest"),
        hasNewer: current.hasNewer || (bounded.trimmed && edge === "oldest"),
      };
    });
  }, [scope, historyWindow]);
  const [hasOlderMessages, setHasOlderMessages] = useScopedState(scope, false);
  const [loadingOlder, setLoadingOlder] = useScopedState(scope, false);
  const [runs, setRuns] = useScopedState<Run[]>(scope, []);
  const [events, setEvents] = useScopedState<RunEvent[]>(scope, []);
  const [eventLoad, setEventLoad] = useScopedState<WorkspaceValue["eventLoad"]>(scope, undefined);
  const [artifacts, setArtifacts] = useScopedState<Artifact[]>(scope, []);
  const [agentId, setAgentId] = useState<string>("general");
  const [mode, setMode] = useState<AgentMode>("code");
  const [draft, setDraftValue] = useScopedState(draftScope, "");
  const [draftHarnessConfigs, setDraftHarnessConfigs] = useScopedState<Record<string, { model?: string; options: Record<string, string> }>>(draftScope, {});
  const draftHarnessConfig = draftHarnessConfigs[agentId] ?? { options: {} };
  const setDraftHarnessConfig = (config: { model?: string; options: Record<string, string> }) => setDraftHarnessConfigs((current) => ({ ...current, [agentId]: config }));
  const [draftApproval, setDraftApproval] = useScopedState<HarnessPermissionProfile | undefined>(draftScope, undefined);
  /* A queued follow-up open in the composer, and the draft it set aside until the edit ends. */
  const [queuedEdit, setQueuedEdit] = useScopedState<{ id: string; original: PromptDraft; saved: PromptDraft } | undefined>(draftScope, undefined);
  const [attachments, setAttachmentValues] = useScopedState<MessageAttachment[]>(draftScope, []);
  const attachmentState = useRef({ scope: draftScope, value: attachments });
  attachmentState.current = { scope: draftScope, value: attachments };
  const attachmentReservations = useRef(new WeakMap<object, number>()).current;
  const [preparingAttachments, setPreparingAttachments] = useScopedState(draftScope, 0);
  const draftRevision = useRef(0);
  const setDraft = useCallback((value: Parameters<typeof setDraftValue>[0]) => {
    draftRevision.current++;
    setDraftValue(value);
  }, [setDraftValue]);
  const setAttachments = useCallback((value: Parameters<typeof setAttachmentValues>[0]) => {
    if (attachmentState.current.scope !== draftScope) return;
    const next = typeof value === "function" ? value(attachmentState.current.value) : value;
    attachmentState.current = { scope: draftScope, value: next };
    draftRevision.current++;
    setAttachmentValues(next);
  }, [setAttachmentValues, draftScope]);
  const [promptStashes, setPromptStashes] = useState<PromptStashEntry[]>(() => {
    try {
      return readPromptStash(localStorage);
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useScopedState(scope, false);
  const [agentCommandsOpen, setAgentCommandsOpen] = useScopedState(scope, false);
  const submissions = useRef(new Set<string>());
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [harnesses, setHarnesses] = useState<HarnessStatus[]>([]);
  const [harnessSessions, setHarnessSessions] = useState<Session[]>([]);
  const [doctors, setDoctors] = useState<Partial<Record<string, HarnessDoctorReport>>>({});
  const statusCache = useRef(new HarnessStatusCache()).current;
  const [statusVersion, renderStatus] = useState(0);
  const statusContext = useRef({ sessions, projects });
  statusContext.current = { sessions, projects };
  const harnessStatuses = useMemo(() => {
    const values: Partial<Record<string, HarnessLiveStatus>> = {};
    for (const thread of sessions) {
      values[thread.id] = statusCache.get(thread, projects.find((project) => project.id === thread.projectId));
    }
    return values;
  }, [sessions, projects, statusCache, statusVersion]);
  const [notice, setNotice] = useScopedState<string | undefined>(scope, undefined);
  const toasts = useToasts();
  const { show: showToast } = toasts;
  /*
   * Slow requests share one notice, so several at once (git status and the
   * turn diff together, say) read as one line instead of a stack over the panel.
   */
  const slowWaiting = useRef(new Map<string, number>());
  slowNotice.current = (name, waiting) => {
    const label = requestLabel(name);
    const count = (slowWaiting.current.get(label) ?? 0) + (waiting ? 1 : -1);
    if (count > 0) slowWaiting.current.set(label, count); else slowWaiting.current.delete(label);
    const labels = [...slowWaiting.current.keys()];
    if (labels.length === 0) { toasts.dismissKey("slow"); return; }
    const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
    toasts.show({ key: "slow", tone: "info", title: `Still waiting on ${list}…`, detail: "This is taking longer than usual. The notice goes away when it finishes.", timeoutMs: 0 });
  };
  const archiving = useRef(new Set<string>());
  const restoring = useRef(new Set<string>());
  const currentSelection = useRef({ projectId, sessionId });
  currentSelection.current = { projectId, sessionId };
  const steering = useRef(new SteeringDrafts()).current;
  const [steeringVersion, renderSteering] = useState(0);
  const steeringKey = JSON.stringify([projectId, sessionId]);
  const steerDraft = steering.get(steeringKey).text;
  const steeringPending = steering.get(steeringKey).pending;
  const setSteerDraft = (value: string) => {
    if (!steering.edit(steeringKey, value)) {
      setNotice("Saved drafts are full. Send or clear a draft in another conversation before adding more text.");
      return;
    }
    renderSteering((version) => version + 1);
  };
  const [git, setGit] = useScopedState<GitStatus | undefined>(scope, undefined);
  const [gitError, setGitError] = useScopedState<string | undefined>(scope, undefined);
  const [files, setFiles] = useScopedState<FileEntry[]>(scope, []);
  const [confirm, setConfirm] = useScopedState<ConfirmState | undefined>(scope, undefined);
  /* On a narrow screen the sidebar is a drawer, so it starts closed whatever the desktop last chose. */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => isNarrow() || storedFlag(SIDEBAR_COLLAPSED_KEY));
  const [inspectorOpen, setInspectorOpen] = useState(() => storedFlag(INSPECTOR_OPEN_KEY));
  const [terminalOpen, setTerminalOpen] = useState(() => storedFlag(TERMINAL_OPEN_KEY));
  const [sidebarWidth, setSidebarWidthState] = useState(() =>
    Math.min(352, Math.max(220, storedNumber(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH))),
  );
  const [skillId, setSkillValue] = useScopedState<string | undefined>(draftScope, undefined);
  const setSkillId = useCallback((id?: string) => { draftRevision.current++; setSkillValue(id); }, [setSkillValue]);
  const [filePicker, setFilePicker] = useState(false);
  const [contentSearch, setContentSearch] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("launcher");
  const [requestedFile, setRequestedFile] = useState<WorkspaceValue["requestedFile"]>();
  const [projectRuns, setProjectRuns] = useState<Run[]>([]);
  const [settings, setSettings] = useState<CapsuleSettings>();
  const [configView, setConfigView] = useState<{ snapshot: ConfigSnapshot; diagnostics: ConfigDiagnostics }>();
  const config = configView?.snapshot;
  const configDiagnostics = configView?.diagnostics;
  const projectSettings = projectSettingsFor(config, projectId) ?? settings;
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>("local");
  // A page address belongs to its thread. A small in-memory cache preserves
  // recent tabs without keeping browser guests running in the background.
  const [browserAddresses, setBrowserAddresses] = useState<Record<string, string>>({});
  const browserOwner = sessionId ?? projectId ?? "inbox";
  const browserUrl = browserAddresses[browserOwner] ?? "";
  const setBrowserUrl = useCallback((url: string) => {
    setBrowserAddresses((current) => Object.fromEntries([
      ...Object.entries(current).filter(([key]) => key !== browserOwner).slice(-19),
      [browserOwner, url],
    ]));
  }, [browserOwner]);
  const skipDraftSave = useRef(true);
  const settingsDefaultsApplied = useRef(false);
  /*
   * macOS hides the window controls in fullscreen, so the inset reserved for
   * them is dead space there. One attribute drives the token, which both the
   * sidebar header and the page header already read.
   */
  useEffect(() => {
    const apply = (value: unknown) => {
      document.documentElement.dataset.fullscreen = value ? "true" : "false";
    };
    apply(false);
    const dispose = api.on("fullscreen", apply);
    return () => {
      dispose();
    };
  }, [api]);

  /* Set during render, before the transcript and diffs that read them draw. */
  useMemo(() => setDisplayPrefs({
    timeFormat: settings?.timeFormat ?? "system",
    toolCallDisplay: projectSettings?.toolCallDisplay ?? "compact",
    diffLayout: projectSettings?.diffLayout ?? "split",
    diffFileState: projectSettings?.diffFileState ?? "expanded",
  }), [settings?.timeFormat, projectSettings?.toolCallDisplay, projectSettings?.diffLayout, projectSettings?.diffFileState]);

  const keyBindings = useMemo(() => effectiveKeymap(configView?.snapshot.keybindings), [configView?.snapshot.keybindings]);


  const project = projects.find((item) => item.id === projectId);
  const session = sessions.find((item) => item.id === sessionId && item.projectId === projectId);
  const selectionExists = Boolean(project && (!sessionId || session));

  /*
   * The settings files as the renderer sees them, reloaded whenever a file,
   * a save or a trust decision changes them, so an edit made in another
   * editor shows here the way a change in Settings does. The user-level
   * settings come with each snapshot.
   */
  const configLoad = useRef(0);
  const loadConfig = useCallback(async () => {
    const generation = ++configLoad.current;
    try {
      const [snapshot, diagnostics] = await Promise.all([api.configGetEffective(projectId), api.configGetDiagnostics(projectId)]);
      if (generation !== configLoad.current) return;
      setConfigView({ snapshot, diagnostics });
      setSettings(snapshot.settings);
      applyAppearance(snapshot.settings, snapshot.themes);
    } catch (error) {
      console.warn("Could not read the settings files", error);
    }
  }, [api, projectId]);
  useEffect(() => {
    void loadConfig();
    const off = api.on("state", (payload) => {
      const command = (payload as { command?: string }).command;
      if (command === "config-updated" || command === "settings-updated" || command === "projects-updated" || command === "automations-updated") void loadConfig();
    });
    return () => { off(); };
  }, [api, loadConfig]);

  /*
   * A new conversation starts from the project's defaults: its record first,
   * then its settings files. Once per project, so a later file edit does not
   * undo a choice made in the composer.
   */
  const projectDefaultsApplied = useRef<string | undefined>(undefined);
  useEffect(() => {
    const scoped = config?.project;
    if (!ready || !agents.length || !scoped || scoped.projectId !== projectId || projectDefaultsApplied.current === projectId) return;
    projectDefaultsApplied.current = projectId;
    if (sessionId) return;
    setWorkspaceModeState(project?.defaultWorkspaceMode ?? scoped.settings.defaultWorkspaceMode);
    if (fromProjectFile(scoped.provenance.defaultMode)) setMode(scoped.settings.defaultMode);
    const fileAgent = fromProjectFile(scoped.provenance.defaultAgentId) ? scoped.settings.defaultAgentId : undefined;
    if (!project?.defaultAgentId && fileAgent && agents.some((item) => item.id === fileAgent)) setAgentId(fileAgent);
  }, [ready, agents, config, projectId, sessionId, project?.defaultWorkspaceMode, project?.defaultAgentId]);
  const currentDraftKey = promptDraftKey(projectId, sessionId);
  const latestDraft = useRef({ key: currentDraftKey, value: { prompt: draft, attachments, skillId } });
  latestDraft.current = { key: currentDraftKey, value: { prompt: draft, attachments, skillId } };
  const promotedDrafts = useRef(new Map<string, PromptDraft>());
  const draftRecovery = useRef(new DraftRecovery()).current;
  const latestStashes = useRef(promptStashes);
  latestStashes.current = promptStashes;
  // An archived or deleted conversation is not a place to go back to.
  useEffect(() => {
    if (!ready || sessions.length === 0) return;
    setNavigation((current) => pruneNavigation(current, (entry) => !entry.sessionId || sessions.some((item) => item.id === entry.sessionId && item.state === "active")));
  }, [ready, sessions]);
  const activeRun = runs.find(
    (run) => run.sessionId === sessionId && ["running", "approval_required", "waiting"].includes(run.status),
  );
  const { turnMode, draftTurnMode, setTurnMode } = useTurnMode({ api, session, settings, setNotice });
  const pendingApprovals = useMemo(() => approvals.filter(
    (item) => item.status === "pending" && runs.some((run) => run.id === item.runId),
  ), [approvals, runs]);
  const pendingApproval = pendingApprovals[0];
  const loadGeneration = useRef(0);
  const liveRunState = useMemo(() => ({ runs: new Map<string, Run>(), events: new Map<string, RunEvent>(), eventBytes: 0, latest: undefined as Run | undefined, loadedOlder: false }), [scope]);
  const connected = status?.state === "connected" && status.kind === "openclaw";
  const selectedHarness = harnesses.find((item) => item.id === agentId);
  const harnessLive = Boolean(
    session?.harnessId === selectedHarness?.id && session?.openclawSessionKey && ["spawning", "running", "waiting"].includes(session.harnessState ?? ""),
  );
  const sendBlockReason = api.isDesktop === false && api.remoteMode === "share"
    ? "This device can only read."
    : api.isDesktop === false && api.remoteMode !== "control"
    ? "This device can only read. To send from here, pair it with conversation control on the computer running Capsule."
    : session?.paused
    ? "This conversation is paused. Resume it to continue."
    : harnessPreflightReason({
    harness: mode === "code" ? selectedHarness : undefined,
    connected,
    folder: session?.workingDirectory ?? project?.workingDirectory,
    live: harnessLive,
    session,
  });

  /*
   * The agent control names the agent this thread talks to, so it follows the
   * thread. It used to hold one selection for the whole app: opening a thread
   * that had been running on another agent still showed the last one picked.
   * Only on a thread change — after that the choice is the user's.
   */
  const threadAgentSynced = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!sessionId || threadAgentSynced.current === sessionId) return;
    const current = sessions.find((item) => item.id === sessionId);
    if (!current) return;
    threadAgentSynced.current = sessionId;
    const threadAgent = current.harnessId ?? current.agentId;
    if (threadAgent && agents.some((item) => item.id === threadAgent)) setAgentId(threadAgent);
    // A profile chose this thread's mode; the composer sends its own mode with every message.
    if (current.profileId) setMode(current.mode);
  }, [agents, sessionId, sessions]);

  const loadSession = useCallback(
    async (id: string) => {
      if (id !== sessionId || !requests.isCurrent(scope)) return;
      const current = requests.capture("messages");
      const generation = ++loadGeneration.current;
      const runsCurrent = requests.capture("project-runs");
      setHistoryLoad((current) => current.state === "loaded" ? current : { state: "loading" });
      // Only the most recent page. Loading an entire conversation on every
      // streamed chunk made a long thread quadratic to render.
      const result = await Promise.all([
        api.listMessagePage(id, { limit: MESSAGE_PAGE_SIZE }),
        api.listRunPage({ sessionId: id }),
      ]).catch((error: unknown) => {
        if (generation === loadGeneration.current && current()) setHistoryLoad({ state: "error", detail: formatUserError(error) });
        throw error;
      });
      const [page, history] = result;
      const nextMessages = page.messages;
      if (generation !== loadGeneration.current || !current()) return;
      setHistoryLoad({ state: "loaded" });
      const nextRuns = mergeRuns(history.runs, [...liveRunState.runs.values()].filter((run) => run.sessionId === id));
      if (!historyWindow.detached) {
        historyWindow.edge = "newest";
        setMessages((current) => mergeMessagePage(current, nextMessages));
      }
      if (!liveRunState.loadedOlder || !page.hasMore) setHasOlderMessages(page.hasMore);
      // Older message pages keep their run receipts when the newest page refreshes.
      setRuns((current) => mergeRuns(current, nextRuns));
      if (runsCurrent()) setProjectRuns((current) => {
        const others = current.filter((item) => item.sessionId !== id);
        return [...nextRuns, ...others];
      });
      const latest = nextRuns[0];
      liveRunState.latest = latest;
      if (latest) {
        setEventLoad({ runId: latest.id, state: "loading" });
        const artifactsCurrent = requests.capture("artifacts");
        const [eventResult, artifactResult] = await Promise.allSettled([
          api.listRunEventPage(latest.id),
          api.listArtifacts(latest.id),
        ]);
        if (generation !== loadGeneration.current || !current()) return;
        if (liveRunState.latest?.id === latest.id) {
          if (eventResult.status === "fulfilled") {
            const eventPage = eventResult.value;
            setEvents((current) => mergeRunEvents(boundRunEvents(eventPage.events, eventPage.hasMore), mergeRunEvents(current, [...liveRunState.events.values()], latest.id), latest.id));
            setEventLoad({ runId: latest.id, state: "loaded" });
          } else setEventLoad({ runId: latest.id, state: "error", detail: formatUserError(eventResult.reason) });
          if (artifactsCurrent() && artifactResult.status === "fulfilled") setArtifacts(artifactResult.value);
        }
      } else {
        setEventLoad(undefined);
        setEvents([]);
        setArtifacts([]);
      }
    },
    [api, scope, sessionId, liveRunState, historyWindow],
  );

  const returnToLatest = useCallback(async () => {
    if (!sessionId) return;
    const current = requests.capture("older-messages");
    // Keep the readable window until its replacement has actually arrived.
    const page = await api.listMessagePage(sessionId, { limit: MESSAGE_PAGE_SIZE });
    if (!current()) return;
    historyWindow.edge = "newest";
    historyWindow.detached = false;
    liveRunState.loadedOlder = false;
    const bounded = boundTranscript(page.messages, "newest");
    setTranscript({ messages: bounded.messages, olderEvicted: bounded.trimmed, hasNewer: false });
    setHasOlderMessages(page.hasMore);
    await loadSession(sessionId);
  }, [api, sessionId, scope, historyWindow, liveRunState, loadSession]);

  const reloadThread = useCallback(async (id: string) => {
    if (id !== sessionId) return;
    const current = requests.capture("older-messages");
    const [page, history] = await Promise.all([api.listMessagePage(id, { limit: MESSAGE_PAGE_SIZE }), api.listRunPage({ sessionId: id })]);
    if (!current()) return;
    const kept = new Set(history.runs.map((run) => run.id));
    for (const [runId, run] of liveRunState.runs) if (run.sessionId === id && !kept.has(runId)) liveRunState.runs.delete(runId);
    historyWindow.edge = "newest";
    historyWindow.detached = false;
    liveRunState.loadedOlder = false;
    const bounded = boundTranscript(page.messages, "newest");
    setTranscript({ messages: bounded.messages, olderEvicted: bounded.trimmed, hasNewer: false });
    setHasOlderMessages(page.hasMore);
    setRuns(history.runs);
    setProjectRuns((runs) => [...history.runs, ...runs.filter((run) => run.sessionId !== id)]);
    await loadSession(id);
  }, [api, sessionId, scope, historyWindow, liveRunState, loadSession]);

  useEffect(() => {
    setRuns((current) => {
      const retained = retainRunReceipts(current, messages);
      return retained.length === current.length ? current : retained;
    });
  }, [messages, runs]);

  const loadOlderMessages = useCallback(async () => {
    if (!sessionId || loadingOlder) return;
    const oldest = messages.find((item) => !item.id.startsWith("local-"));
    if (!oldest) return;
    const current = requests.capture("older-messages");
    setLoadingOlder(true);
    try {
      const page = await api.listMessagePage(sessionId, {
        limit: MESSAGE_PAGE_SIZE,
        before: { createdAt: oldest.createdAt, id: oldest.id },
      });
      const history = await api.listRunPage({ sessionId, before: { createdAt: oldest.createdAt, id: "\uffff" } });
      if (!current()) return;
      historyWindow.edge = "oldest";
      setRuns((current) => mergeRuns(current, history.runs));
      liveRunState.loadedOlder = true;
      setMessages((current) => mergeMessagePage(current, page.messages));
      setHasOlderMessages(page.hasMore);
      setTranscript((current) => ({ ...current, olderEvicted: false }));
    } finally {
      setLoadingOlder(false);
    }
  }, [api, scope, sessionId, messages, loadingOlder, liveRunState, historyWindow]);

  const refresh = useCallback(async () => {
    if (!requests.isCurrent(scope)) return;
    const current = requests.capture("workspace");
    setStartupError(undefined);
    try {
      // Resolve persisted navigation before calling APIs that require ownership.
      // A deleted project or thread must not reject the entire startup snapshot.
      const [nextProjects, nextSessions] = await Promise.all([api.listProjects(), api.listSessions()]);
      if (!current()) return;
      const selected = resolveWorkspaceSelection(nextProjects, nextSessions, projectId, sessionId);
      const runsCurrent = requests.capture("project-runs");
      const [
        nextAgents,
        nextSkills,
        nextStatus,
        nextSub,
        nextApprovals,
        nextHarnesses,
        nextSettings,
        nextHarnessSessions,
        nextRuns,
      ] = await Promise.all([
          api.listAgents(),
          api.listSkills(selected.projectId, selected.sessionId),
          api.getStatus(),
          api.getSubsystemStatus(),
          api.listApprovals("pending"),
          api.listHarnesses(),
          api.getSettings(),
          selected.projectId ? api.listHarnessSessions(selected.projectId) : Promise.resolve([]),
          api.listLatestRuns(),
        ]);
      if (!current()) return;
      setProjects(nextProjects);
      setSessions(nextSessions);
      setAgents(nextAgents);
      setSkills(nextSkills);
      setStatus(nextStatus);
      setSubsystems(nextSub);
      setApprovals(nextApprovals);
      setHarnesses(nextHarnesses);
      setSettings(nextSettings as CapsuleSettings);
      applyAppearance(nextSettings as CapsuleSettings);
      if (!settingsDefaultsApplied.current && nextSettings) {
        const loaded = nextSettings as CapsuleSettings;
        settingsDefaultsApplied.current = true;
        setMode("code");
        setWorkspaceModeState(loaded.defaultWorkspaceMode);
        const defaultAgent =
          loaded.defaultAgentId && nextAgents.some((item: Agent) => item.id === loaded.defaultAgentId)
            ? loaded.defaultAgentId
            : nextAgents[0]?.id;
        if (defaultAgent) setAgentId(defaultAgent);
      } else if (!nextAgents.some((item: Agent) => item.id === agentId)) {
        // The stored choice can be a mock-only agent from an offline session.
        // Never keep it selected once the live Gateway reports its real catalog.
        const fallbackAgent = nextAgents[0]?.id;
        if (fallbackAgent) setAgentId(fallbackAgent);
      }
      if (selected.projectId !== projectId) {
        applyProjectDefaults(nextProjects.find((item: Project) => item.id === selected.projectId), nextHarnesses);
        setProjectId(selected.projectId);
      }
      if (selected.sessionId !== sessionId) setSessionId(selected.sessionId);
      setHarnessSessions(nextHarnessSessions);
      if (runsCurrent()) setProjectRuns(mergeRuns(nextRuns, [...liveRunState.runs.values()]));
      const recoveredError = refreshError.current;
      if (recoveredError?.scope === scope) {
        setNotice((notice) => notice === recoveredError.detail ? undefined : notice);
        refreshError.current = undefined;
      }
      setReady(true);
    } catch (error) {
      if (!current()) return;
      console.error("Failed to load Capsule state", error);
      const detail = formatUserError(error);
      refreshError.current = { scope, detail };
      setStartupError(detail);
      setNotice(detail);
    }
  }, [agentId, api, scope, projectId, sessionId, liveRunState]);

  const loadGit = useCallback(async () => {
    if (!projectId || !selectionExists || !requests.isCurrent(scope)) return;
    const current = requests.capture("git");
    try {
      const result = await api.gitStatus(projectId, sessionId);
      if (current()) { setGit(result); setGitError(undefined); }
    } catch (error) {
      // Nobody asked for this read: the last good status stays, and the reason waits in Conversation details.
      if (current()) setGitError(formatUserError(error));
    }
  }, [api, scope, projectId, sessionId, selectionExists]);

  /* Remote-tracking refs go stale between pushes; a quiet fetch keeps ahead and behind true. Desktop only: it writes refs. */
  const gitFetch = useCallback(async () => {
    if (!projectId || !selectionExists || api.isDesktop === false || !requests.isCurrent(scope)) return;
    try {
      if (await api.gitFetch(projectId, sessionId)) await loadGit();
    } catch { /* A fetch that cannot run leaves the last status. */ }
  }, [api, scope, projectId, sessionId, selectionExists, loadGit]);

  useEffect(() => {
    void refresh();
    const batch = batchRunFrames((frames) => {
      if (!requests.isCurrent(scope)) return;
      const records = frames.filter((frame): frame is Run => "status" in frame).map(summarizeRun);
      const threadRecords = records.filter((run) => run.sessionId === sessionId);
      if (records.length) setProjectRuns((current) => mergeRuns(current, records));
      if (threadRecords.length) setRuns((current) => mergeRuns(current, threadRecords));
      const latest = liveRunState.latest;
      const updates = frames.filter((frame): frame is RunEvent => "runId" in frame);
      if (latest) setEvents((current) => mergeRunEvents(current, updates, latest.id));
      // Artifacts are durable outputs, not a reason to reload all history on every token.
      if (latest && threadRecords.some((run) => run.id === latest.id && run.completedAt)) {
        const artifactsCurrent = requests.capture("artifacts");
        void api.listArtifacts(latest.id).then((items) => {
          if (artifactsCurrent() && liveRunState.latest?.id === latest.id) setArtifacts(items);
        }).catch((error) => { if (requests.isCurrent(scope)) setNotice(formatUserError(error)); });
      }
    });
    const off = [
      api.on("connection", () => {
        if (!api.isDesktop && api.remoteMode === "connecting") return;
        void refresh();
        if (sessionId && selectionExists) void loadSession(sessionId).catch(() => { /* History owns its loading and retry UI. */ });
      }),
      api.on("message", (incoming) => {
        const message = incoming as ChatMessage;
        if (!sessionId || message?.sessionId !== sessionId) return;
        if (historyWindow.detached) return;
        historyWindow.edge = "newest";
        // Append the frame we were handed rather than re-reading the whole
        // conversation; a full reload per chunk is what made this quadratic.
        setMessages((current) => {
          if (current.some((item) => item.id === message.id)) return current;
          const withoutOptimistic = current.filter(
            (item) =>
              !(item.id.startsWith("local-") && item.role === message.role && item.content === message.content),
          );
          return [...withoutOptimistic, message];
        });
      }),
      api.on("run", (payload) => {
        let frame = payload as Run | RunEvent;
        if (!frame?.id) return;
        if ("status" in frame) {
          frame = summarizeRun(frame);
          const previous = liveRunState.runs.get(frame.id) ?? (liveRunState.latest?.id === frame.id ? liveRunState.latest : undefined);
          if (previous && previous.updatedAt > frame.updatedAt) return;
          liveRunState.runs.set(frame.id, frame);
          while (liveRunState.runs.size > 1000) liveRunState.runs.delete(liveRunState.runs.keys().next().value!);
          if (frame.sessionId === sessionId && (!liveRunState.latest || frame.createdAt >= liveRunState.latest.createdAt)) {
            if (liveRunState.latest?.id !== frame.id) {
              requests.capture("artifacts"); // Invalidate a previous turn's pending read.
              setArtifacts([]);
            }
            liveRunState.latest = frame;
            for (const [id, event] of liveRunState.events) if (event.runId !== frame.id) {
              liveRunState.events.delete(id); liveRunState.eventBytes -= runEventBytes(event);
            }
          }
        } else if (!sessionId || (frame.sessionId !== sessionId && liveRunState.latest?.id !== frame.runId)) return;
        else {
          frame = compactRunEvent(frame);
          const previous = liveRunState.events.get(frame.id);
          liveRunState.eventBytes += runEventBytes(frame) - (previous ? runEventBytes(previous) : 0);
          liveRunState.events.set(frame.id, frame);
          while (liveRunState.events.size > LIVE_EVENT_LIMIT || liveRunState.eventBytes > LIVE_EVENT_BYTES) {
            const oldest = liveRunState.events.values().next().value;
            if (!oldest) break;
            liveRunState.eventBytes -= runEventBytes(oldest); liveRunState.events.delete(oldest.id);
          }
        }
        batch.push(frame);
      }),
      api.on("approval", () => void refresh()),
      api.on("state", (payload) => {
        const command = (payload as { command?: string; }).command;
        if (command === "harness-configuration") {
          const target = (payload as { sessionId?: string }).sessionId;
          if (target) void readHarnessStatus(target, true).catch(() => undefined);
        }
        if (command === "palette") setPalette(true);
        if (command === "new-task") void createTask();
        if (command === "skills") setView("skills");
        if (command === "about") setAboutOpen(true);
        if (command === "approvals") setView("approvals");
        /*
         * Opened from the menu bar, which lists the threads waiting on a
         * person. Landing on the thread is the whole point of the entry, so
         * the chat view comes with it.
         */
        if (command === "open-session") {
          const target = (payload as { sessionId?: string }).sessionId;
          if (target) {
            setSessionId(target);
            setView("chat");
          }
        }
        if (command === "harness") setView("runtimes");
        if (command === "new-project") void createProjectFromFolder();
        if (command === "open-folder") void pickProjectDirectory();
        if (command === "open-files") void pickFilesToMention();
        /*
         * The agent was refused the browser. The grant lives in the Browser
         * panel behind a small shield; offer it here, where the person is
         * reading the agent's reply. Only for the thread on screen, because a
         * grant belongs to the visible thread.
         */
        if (command === "browser-access-requested") {
          const owner = (payload as { threadId?: string }).threadId;
          if (!owner || owner !== sessionId) return;
          showToast({
            key: `browser-access:${owner}`, tone: "info", timeoutMs: 0,
            title: "The agent wants to use the browser",
            detail: "Allowing opens this conversation's Browser panel. Access ends when you switch conversations or close the panel.",
            action: { label: "Allow", run: () => { setInspectorTab("browser"); setInspectorOpen(true); requestBrowserCommand({ type: "allow-agent" }); } },
          });
        }
        if (command === "open-browser") {
          const owner = (payload as { threadId?: string }).threadId;
          if (owner && owner !== sessionId) return;
          const url = (payload as { url?: string }).url;
          if (url && /^https?:\/\//i.test(url)) {
            setBrowserUrl(url);
            setInspectorTab("browser");
            setInspectorOpen(true);
          }
        }
        if (command === "settings") {
          setPalette(false);
          setView("settings");
        }
        if (
          command === "harness" ||
          command === "harness-updated" ||
          command === "skills-updated" ||
          command === "projects-updated" ||
          command === "sessions-updated"
        ) {
          void refresh();
        }
        if (command === "git-updated" && projectId) {
          void loadGit();
        }
      }),
    ];
    return () => {
      batch.dispose();
      off.forEach((fn) => fn());
    };
  }, [api, loadGit, loadSession, projectId, refresh, sessionId, scope, liveRunState, setBrowserUrl, selectionExists, showToast]);

  useEffect(() => {
    if (sessionId && selectionExists) void loadSession(sessionId).catch(() => { /* History owns its loading and retry UI. */ });
  }, [sessionId, loadSession, selectionExists]);

  useEffect(() => {
    if (session?.workspaceMode) setWorkspaceModeState(session.workspaceMode);
  }, [session?.id, session?.workspaceMode]);

  useEffect(() => {
    skipDraftSave.current = true;
    try {
      const saved = promotedDrafts.current.get(currentDraftKey) ?? draftRecovery.read(localStorage, currentDraftKey);
      promotedDrafts.current.delete(currentDraftKey);
      setDraft(saved.prompt);
      setAttachments(saved.attachments);
      setSkillId(saved.skillId);
      setDraftHarnessConfigs(saved.settings?.harness ?? {});
      setDraftApproval(saved.settings?.approval);
    } catch {
      setDraft("");
      setAttachments([]);
      setSkillId(undefined);
    }
    setQueuedEdit(undefined);
  }, [currentDraftKey]);

  useEffect(() => {
    if (skipDraftSave.current) {
      skipDraftSave.current = false;
      return;
    }
    try {
      // A conversation that has started keeps its settings itself; only one that has not needs them here.
      const settings = messages.length === 0 && (draftApproval || Object.keys(draftHarnessConfigs).length) ? { settings: { harness: draftHarnessConfigs, ...(draftApproval ? { approval: draftApproval } : {}) } } : {};
      // While a queued message is being edited, the draft it set aside is the one to keep.
      const result = draftRecovery.save(localStorage, currentDraftKey, queuedEdit ? queuedEdit.saved : { prompt: draft, attachments, skillId, ...settings });
      if (result !== "saved") setNotice(result === "temporary"
        ? "This draft is kept temporarily until the app closes because local storage could not save it. Copy it before quitting."
        : "Draft recovery storage is full. Copy this draft before switching conversations or quitting; these edits could not be saved.");
    } catch {
      // Draft persistence is a convenience; storage policy must not break chat.
    }
  }, [attachments, currentDraftKey, draft, skillId, draftHarnessConfigs, draftApproval, queuedEdit, messages.length]);

  useEffect(() => {
    // The drawer's open and closed states on a phone are not the desktop's preference.
    if (isNarrow()) return;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore quota */
    }
  }, [sidebarCollapsed]);

  /* Picking a conversation or a view from the drawer closes it, so what was picked is visible. */
  useEffect(() => {
    if (isNarrow()) setSidebarCollapsed(true);
  }, [sessionId, view]);

  useEffect(() => {
    try {
      localStorage.setItem(INSPECTOR_OPEN_KEY, inspectorOpen ? "1" : "0");
    } catch {
      /* ignore quota */
    }
  }, [inspectorOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(TERMINAL_OPEN_KEY, terminalOpen ? "1" : "0");
    } catch {
      /* ignore quota */
    }
  }, [terminalOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // Storage unavailable.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    try {
      if (projectId) localStorage.setItem(LAST_PROJECT_ID_KEY, projectId);
      else localStorage.removeItem(LAST_PROJECT_ID_KEY);
    } catch {
      // Storage unavailable.
    }
  }, [projectId]);

  useEffect(() => {
    try {
      if (sessionId) localStorage.setItem(LAST_SESSION_ID_KEY, sessionId);
      else localStorage.removeItem(LAST_SESSION_ID_KEY);
    } catch {
      // Storage unavailable.
    }
  }, [sessionId]);

  function setSidebarWidth(value: number) {
    setSidebarWidthState(Math.min(352, Math.max(220, Math.round(value))));
  }

  function applyProjectDefaults(nextProject: Project | undefined, nextHarnesses = harnesses) {
    if (!nextProject) return;
    const dedicatedHarness = nextHarnesses.some((item) => item.id === nextProject.defaultAgentId);
    if (dedicatedHarness && nextProject.defaultAgentId) {
      setAgentId(nextProject.defaultAgentId);
      setMode("code");
      return;
    }
    if (nextProject.defaultAgentId && agents.some((item) => item.id === nextProject.defaultAgentId)) {
      setAgentId(nextProject.defaultAgentId);
    }
    setMode("code");
  }

  /*
   * Review reads its diff fresh when it opens, but the status beside it was
   * only loaded with the project, so an edit made outside the app showed a
   * diff next to "Working tree clean". Reload it with Review, and on focus.
   */
  const reviewShowing = inspectorOpen && inspectorTab === "changes";
  useEffect(() => {
    if (!reviewShowing || !projectId || !selectionExists) return;
    void loadGit();
    const onFocus = () => void loadGit();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reviewShowing, projectId, selectionExists, loadGit]);

  useEffect(() => {
    if (!projectId || !selectionExists) {
      setGit(undefined);
      setFiles([]);
      return;
    }
    void loadGit().then(() => gitFetch());
    void api
      .listFiles(projectId, ".", session?.workingDirectory)
      .then((entries: FileEntry[]) =>
        setFiles(
          entries.filter(
            (entry) =>
              !entry.name.startsWith(".") &&
              entry.name !== "node_modules" &&
              entry.name !== "dist" &&
              entry.name !== "out",
          ),
        ),
      )
      .catch(() => setFiles([]));
  }, [api, scope, loadGit, gitFetch, projectId, project?.workingDirectory, sessionId, session?.workingDirectory, selectionExists]);

  async function createTask(inProject?: string, initialPrompt?: string, options?: CreateTaskOptions) {
    if (api.isDesktop === false && api.remoteMode !== "control") {
      setNotice("This device can only read. Pair it with conversation control to start a conversation.");
      return;
    }
    const targetProject = inProject ?? projectId ?? projects[0]?.id;
    if (!targetProject) return;
    // Permission and workspace come from the target project's record and
    // settings files, which the engine reads; it also keeps a folder that is
    // not a Git repository local.
    const created = await api.createSession({
      projectId: targetProject,
      agentId,
      mode,
      ...(draftApproval ? { permissionProfile: draftApproval } : {}),
      ...(options?.temporary ? { temporary: true, workspaceMode: "local" as const } : options?.workspaceMode ? { workspaceMode: options.workspaceMode } : {}),
      title: options?.title ?? "New conversation",
      ...(options?.branchName ? { branchName: options.branchName } : {}),
    });
    if (!requests.isCurrent(scope)) return;
    // The draft scope moves with the selection, so a prompt written after the
    // switch was dropped. Hand it to the new thread's own draft instead.
    if (initialPrompt) promotedDrafts.current.set(promptDraftKey(targetProject, created.id), { prompt: initialPrompt, attachments: [] });
    // A thread is looked up within the selected project; selecting only the
    // thread left it unfound, and the view fell back to the old project.
    setProjectId(targetProject);
    setSessionId(created.id);
    setView("chat");
    await refresh();
  }

  /* A profile picks the agent, mode, permission, workspace and model; the engine applies it. */
  async function startWithProfile(profileId: string, inProject?: string) {
    if (api.isDesktop === false && api.remoteMode !== "control") {
      setNotice("This device can only read. Pair it with conversation control to start a conversation.");
      return;
    }
    const targetProject = inProject ?? projectId ?? projects[0]?.id;
    if (!targetProject) return;
    try {
      const created = await api.createSession({ projectId: targetProject, profileId, title: "New conversation" });
      if (!requests.isCurrent(scope)) return;
      setProjectId(targetProject);
      setSessionId(created.id);
      setView("chat");
      await refresh();
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  /*
   * Follow-ups while a turn runs, and a turn scheduled to resume when a usage
   * limit lifts. The engine keeps and sends both, so they go out in a thread
   * that is not on screen, or with the window closed; this mirrors the
   * selected conversation's and sends each change as one operation.
   */
  const [followUps, setFollowUps] = useState<FollowUps>(EMPTY_FOLLOW_UPS);
  const queue = followUps.queue;
  useEffect(() => {
    setFollowUps(EMPTY_FOLLOW_UPS);
    if (!sessionId) return;
    let current = true;
    const unsubscribe = api.on("state", (payload) => {
      const event = payload as { command?: string; sessionId?: string; followUps?: FollowUps };
      if (event.command === "follow-ups-updated" && event.sessionId === sessionId && event.followUps) setFollowUps(event.followUps);
    });
    void (async () => {
      try {
        let state = await api.getFollowUps(sessionId);
        // A queue or plan an older build kept in this window moves to the engine once.
        const legacy = loadQueue(localStorage, sessionId);
        for (const item of legacy) {
          state = await api.updateFollowUps(sessionId, { type: "add", prompt: { content: item.content, attachments: item.attachments, ...(item.skillId ? { skillId: item.skillId } : {}) } });
        }
        if (legacy.length) saveQueue(localStorage, sessionId, []);
        const legacyResume = localStorage.getItem(`capsule.resume:${sessionId}`);
        if (legacyResume) {
          const parsed = JSON.parse(legacyResume) as Partial<ScheduledResume>;
          if (!state.resume && typeof parsed.runId === "string" && typeof parsed.prompt === "string" && typeof parsed.at === "number") {
            state = await api.updateFollowUps(sessionId, { type: "schedule", resume: { runId: parsed.runId, prompt: parsed.prompt, attachments: parsed.attachments ?? [], at: parsed.at } });
          }
          localStorage.removeItem(`capsule.resume:${sessionId}`);
        }
        if (current) setFollowUps(state);
      } catch {
        /* A viewer without the channel, or an engine still starting: the queue stays empty here. */
      }
    })();
    return () => { current = false; unsubscribe(); };
  }, [api, sessionId]);
  const changeFollowUps = async (op: FollowUpOp) => {
    if (!sessionId) return;
    try {
      setFollowUps(await api.updateFollowUps(sessionId, op));
    } catch (error) {
      setNotice(formatUserError(error));
    }
  };
  /*
   * Find belongs to the thread it was opened on, so a search hit can open it
   * on another thread, with the words that matched, as it selects that thread.
   * Moving to any other thread closes it.
   */
  const [find, setFind] = useState<{ sessionId?: string; query: string }>();
  useEffect(() => { setFind((current) => current && current.sessionId !== sessionId ? undefined : current); }, [sessionId]);
  const threadFind = find !== undefined && find.sessionId === sessionId;
  const threadFindQuery = threadFind ? find.query : "";
  const setThreadFind = (open: boolean | ((current: boolean) => boolean)) => setFind((current) => {
    const here = currentSelection.current.sessionId;
    const showing = current !== undefined && current.sessionId === here;
    const next = typeof open === "function" ? open(showing) : open;
    return !next ? undefined : showing ? current : { sessionId: here, query: "" };
  });
  /* Selects the thread and opens find on it, seeded with the query that found it. */
  const findInThread = (targetProjectId: string, targetSessionId: string, query: string) => {
    if (targetProjectId !== currentSelection.current.projectId) applyProjectDefaults(projects.find((item) => item.id === targetProjectId));
    setProjectId(targetProjectId);
    setSessionId(targetSessionId);
    setView("chat");
    setFind({ sessionId: targetSessionId, query: query.trim() });
  };
  const [promptJump, setPromptJump] = useState(false);
  useEffect(() => { setPromptJump(false); }, [sessionId]);

  const pendingResume: PendingResume | undefined = sessionId && followUps.resume ? { sessionId, ...followUps.resume } : undefined;
  // A limit stop's files live on its prompt message, not on the run.
  const attachmentsForRun = (runId: string): MessageAttachment[] =>
    messages.find((message) => message.runId === runId && message.role === "user")?.attachments ?? [];
  const scheduleResume = (runId: string, prompt: string, at: number) => {
    if (!prompt.trim()) return;
    void changeFollowUps({ type: "schedule", resume: { runId, prompt, attachments: attachmentsForRun(runId), at } });
  };
  const cancelResume = () => { void changeFollowUps({ type: "cancel-resume" }); };
  const retryPrompt = (prompt: string, runId?: string) => {
    if (!prompt.trim() || !sessionId) return;
    const threadId = sessionId;
    // Retry is the person asking for it now, so it goes first even past a held queue.
    void (async () => {
      try {
        const added = await api.updateFollowUps(threadId, { type: "add", prompt: { content: prompt, attachments: runId ? attachmentsForRun(runId) : [] } });
        const id = added.queue.at(-1)?.id;
        setFollowUps(id ? await api.updateFollowUps(threadId, { type: "release", id }) : added);
      } catch (error) {
        setNotice(formatUserError(error));
      }
    })();
  };

  /*
   * The newest render's handles on the selected conversation. A first message
   * selects the conversation it creates part-way through send(), and the rest
   * of that send writes into the new conversation's state, not the empty
   * one it started from.
   */
  const handles = { setMessages, setNotice, setBusy, setDraft, setAttachments, setSkillId, loadSession, refresh, draftScope };
  const latest = useRef(handles);
  latest.current = handles;

  /** Select a conversation the engine just created, before a refresh lists it. */
  const showConversation = (created: Session) => {
    setSessions((current) => current.some((item) => item.id === created.id) ? current : [created, ...current]);
    setProjectId(created.projectId);
    setSessionId(created.id);
  };

  async function send(continueToNew = false, command?: string, followUp?: "steer" | "queue") {
    if (attachmentReservations.get(draftScope)) {
      setNotice("Attachments are still being prepared. Wait for them before sending.");
      return false;
    }
    const submissionKey = currentDraftKey;
    const submittedRevision = draftRevision.current;
    const content = command ?? (draft.trim() || (skillId ? `Use the ${skills.find((item) => item.id === skillId)?.name ?? "selected"} skill.` : ""));
    const filesToSend = command ? [] : attachmentState.current.value;
    const promptSkill = command ? undefined : skillId;
    if ((!content && filesToSend.length === 0) || busy || submissions.current.has(submissionKey)) return false;
    if (activeRun) {
      // A read-only viewer would queue a prompt that can never be sent.
      if (api.isDesktop === false && api.remoteMode !== "control" && sendBlockReason) {
        setNotice(sendBlockReason);
        return false;
      }
      if (!sessionId) return false;
      const threadId = sessionId;
      const agent = harnesses.find((item) => item.id === session?.harnessId);
      /*
       * Settings › General › Follow-ups: steer sends the text into the running
       * turn when this agent can take it. Attachments, skills, commands, an
       * agent that cannot steer (direct mode) and a paired device queue
       * instead, quietly: for them that is the expected path, not a failure.
       */
      const steerable = (followUp ?? settings?.followUpBehavior) === "steer" && Boolean(agent)
        && !command && filesToSend.length === 0 && !promptSkill
        && canSteerTurn({ harness: agent, session, status: harnessStatuses[threadId], desktop: api.isDesktop !== false });
      // Clear first and hold the key, so a second Enter cannot send the same text twice.
      submissions.current.add(submissionKey);
      if (!command) {
        setDraft("");
        setAttachments([]);
        setSkillId(undefined);
      }
      const clearedRevision = draftRevision.current;
      try {
        let steered = false;
        if (steerable) {
          try {
            await api.steerHarness(threadId, content);
            steered = true;
            void loadSession(threadId).catch(() => { /* The live stream carries it too. */ });
          } catch {
            setNotice(`${agent?.name ?? "This agent"} can't take messages mid-turn, so yours is queued and will send when this turn ends.`);
          }
        }
        if (!steered) {
          try {
            const state = await api.updateFollowUps(threadId, { type: "add", prompt: { content, attachments: filesToSend, ...(promptSkill ? { skillId: promptSkill } : {}) } });
            if (draftScopes.isCurrent(draftScope)) setFollowUps(state);
          } catch (error) {
            if (!command && draftScopes.isCurrent(draftScope) && draftRevision.current === clearedRevision) {
              setDraft(draft);
              setAttachments(filesToSend);
              setSkillId(promptSkill);
            }
            setNotice(formatUserError(error));
            return false;
          }
        }
        // ⌘Enter: the message goes to this turn, and the composer moves to a new conversation.
        const targetProject = session?.projectId ?? projectId;
        if (continueToNew && targetProject && draftScopes.isCurrent(draftScope)) {
          try {
            const next = await api.createSession({
              projectId: targetProject,
              agentId,
              mode,
              ...(draftApproval ? { permissionProfile: draftApproval } : {}),
              title: "New conversation",
            });
            if (draftScopes.isCurrent(draftScope)) {
              // Anything typed while the message went out moves with the composer.
              const typed = draftRevision.current !== clearedRevision ? latestDraft.current.value : { prompt: "", attachments: [] };
              promotedDrafts.current.set(promptDraftKey(next.projectId, next.id), typed);
              draftRecovery.save(localStorage, submissionKey, { prompt: "", attachments: [] });
              showConversation(next);
            }
          } catch (error) {
            setNotice(`Your message was ${steered ? "sent" : "queued"}, but a new conversation could not start: ${formatUserError(error)}`);
          }
        }
        return true;
      } finally {
        submissions.current.delete(submissionKey);
      }
    }
    if (sendBlockReason) {
      setNotice(sendBlockReason);
      return false;
    }
    submissions.current.add(submissionKey);
    setBusy(true);
    setNotice(undefined);
    // Where the composer is. A first message moves it to the conversation it creates.
    let shown = { projectId, sessionId, key: submissionKey };
    let ui = latest.current;
    let opened = false;
    let preparedThread = false;
    let accepted = false;
    const stillHere = () => draftScopes.isCurrent(ui.draftScope);
    const recoverSubmission = (error: unknown, targetProjectId = projectId) => {
      const recovery = recoverFailedPrompt(localStorage, latestStashes.current, {
        prompt: content, attachments: filesToSend, skillId: promptSkill, projectId: targetProjectId,
      });
      latestStashes.current = recovery.entries;
      setPromptStashes(recovery.entries);
      const location = recovery.persisted ? "saved in Stash" : "kept temporarily in Stash until the app closes; local storage could not save it";
      ui.setNotice(`The message was not sent and was ${location}. Your new draft is unchanged. ${formatUserError(error)}`);
    };
    // A first message that fails goes back into its new conversation's composer, or to Stash if that composer is in use.
    const giveBack = (error: unknown) => {
      const composer = latestDraft.current;
      if (!command && stillHere() && composer.key === shown.key && !composer.value.prompt.trim() && composer.value.attachments.length === 0) {
        ui.setDraft(draft);
        ui.setAttachments(filesToSend);
        ui.setSkillId(promptSkill);
        ui.setNotice(formatUserError(error));
      } else recoverSubmission(error, shown.projectId);
    };
    try {
      if (historyWindow.detached) await returnToLatest();
      let currentSessionId = sessionId;
      let currentProjectId = projectId ?? projects[0]?.id;
      if (!currentProjectId) {
        const createdProject = await api.createProject({ name: "Inbox" });
        currentProjectId = createdProject.id;
      }
      if (!currentSessionId) {
        const created = await api.createSession({
          projectId: currentProjectId,
          agentId,
          mode,
          ...(draftApproval ? { permissionProfile: draftApproval } : {}),
          workspaceMode: git?.isRepo ? workspaceMode : "local",
          title: "New conversation",
          turnMode: draftTurnMode,
        });
        if (!draftScopes.isCurrent(draftScope)) return false;
        currentSessionId = created.id;
        /*
         * Open the new conversation now, not once the agent has started. The
         * message, the agent starting and Stop then show together, and the
         * turn's live frames, kept only for the conversation on screen, are
         * not dropped while the agent spawns. Its composer starts empty, or
         * with whatever was typed while the conversation was being created.
         */
        const key = promptDraftKey(created.projectId, created.id);
        promotedDrafts.current.set(key, draftRevision.current !== submittedRevision ? latestDraft.current.value : { prompt: "", attachments: [] });
        draftRecovery.save(localStorage, submissionKey, { prompt: "", attachments: [] });
        flushSync(() => showConversation(created));
        ui = latest.current;
        shown = { projectId: created.projectId, sessionId: created.id, key };
        opened = true;
        submissions.current.add(key);
        ui.setBusy(true);
      }
      if (!currentSessionId) return false;
      if (!stillHere()) return false;
      preparedThread = true;
      if (draftHarnessConfig.model || Object.keys(draftHarnessConfig.options).length) {
        await api.spawnHarness({ projectId: currentProjectId, sessionId: currentSessionId, harnessId: agentId,
          model: draftHarnessConfig.model, permissionProfile: draftApproval ?? projectSettings?.defaultPermission ?? settings?.defaultPermission });
        if (draftHarnessConfig.model) await api.setHarnessOption({ sessionId: currentSessionId, key: "model", value: draftHarnessConfig.model });
        for (const [id, value] of Object.entries(draftHarnessConfig.options)) await api.setHarnessConfig(currentSessionId, id, value);
        // A conversation this send opened keeps going if the person looks elsewhere.
        if (!opened && !stillHere()) return false;
        setDraftHarnessConfigs((current) => { const next = { ...current }; delete next[agentId]; return next; });
      }
      const optimisticId = `local-${Date.now()}`;
      ui.setMessages((current) => [
        ...current.filter((item) => !item.id.startsWith("local-")),
        {
          id: optimisticId,
          sessionId: currentSessionId,
          role: "user",
          content,
          attachments: filesToSend.length > 0 ? filesToSend : undefined,
          createdAt: new Date().toISOString(),
        },
      ]);
      // An opened conversation's composer was emptied when it was selected.
      const unchanged = !opened && !command && draftRevision.current === submittedRevision;
      if (unchanged) {
        setDraft("");
        setAttachments([]);
        setSkillId(undefined);
      }
      let clearedRevision = unchanged ? draftRevision.current : undefined;
      try {
        await api.sendMessage({
          sessionId: currentSessionId,
          content,
          agentId,
          mode,
          skillId: promptSkill,
          attachments: filesToSend,
        });
        accepted = true;
        if (draftScopes.isCurrent(draftScope) && draftRevision.current === clearedRevision) {
          setSkillId(undefined);
          // That was this send's own change, not the person typing a follow-up.
          clearedRevision = draftRevision.current;
        }
        let selectionChanged = false;
        if (stillHere()) {
          const next = continueToNew ? await api.createSession({
            projectId: currentProjectId,
            agentId,
            mode,
            ...(draftApproval ? { permissionProfile: draftApproval } : {}),
            title: "New conversation",
          }) : undefined;
          if (stillHere()) {
            selectionChanged = Boolean(next) || shown.projectId !== currentProjectId || shown.sessionId !== currentSessionId;
            if (selectionChanged) {
              // Promote any follow-up typed during creation or sending with its
              // new thread. Keep an in-memory handoff if storage is unavailable.
              const targetKey = promptDraftKey(currentProjectId, next?.id ?? currentSessionId);
              const followup = latestDraft.current.key === shown.key
                && draftRevision.current !== clearedRevision ? latestDraft.current.value : { prompt: "", attachments: [] };
              promotedDrafts.current.set(targetKey, followup);
              draftRecovery.save(localStorage, targetKey, followup);
              draftRecovery.save(localStorage, shown.key, { prompt: "", attachments: [] });
            }
            setProjectId(currentProjectId);
            setSessionId(next?.id ?? currentSessionId);
            if (!next && currentSessionId === shown.sessionId) await latest.current.loadSession(currentSessionId);
          }
        }
        // The new selection's effect owns its refresh. The old selection's
        // refresh can otherwise auto-select the first thread over the new one.
        if (!selectionChanged) await latest.current.refresh();
        return true;
      } catch (error) {
        if (!accepted) {
          ui.setMessages((current) => current.filter((item) => item.id !== optimisticId));
          if (opened) throw error;
          if (draftScopes.isCurrent(draftScope) && draftRevision.current === clearedRevision) {
            setDraft(content);
            setAttachments(filesToSend);
            setSkillId(skillId);
          } else {
            // Keep the new draft and preserve the failed submission separately.
            recoverSubmission(error, currentProjectId);
            return false;
          }
        } else {
          if (stillHere()) {
            setProjectId(currentProjectId);
            setSessionId(currentSessionId);
          }
          ui.setNotice(`Your message was sent, but the view could not refresh: ${formatUserError(error)}`);
          return true;
        }
        throw error;
      }
    } catch (error) {
      if (opened && !accepted) giveBack(error);
      else if (!preparedThread && draftRevision.current !== submittedRevision) recoverSubmission(error);
      else ui.setNotice(formatUserError(error));
      return false;
    } finally {
      submissions.current.delete(submissionKey);
      submissions.current.delete(shown.key);
      setBusy(false);
      ui.setBusy(false);
    }
  }

  function removeQueued(id: string) {
    void changeFollowUps({ type: "remove", id });
  }
  function moveQueued(id: string, direction: "up" | "down") {
    void changeFollowUps({ type: "move", id, direction });
  }
  function editQueued(id: string) {
    const item = queue.find((entry) => entry.id === id);
    if (!item) return;
    const original = { prompt: item.content, attachments: item.attachments, ...(item.skillId ? { skillId: item.skillId } : {}) };
    setQueuedEdit({ id, original, saved: queuedEdit?.saved ?? { prompt: draft, attachments, ...(skillId ? { skillId } : {}) } });
    setDraft(item.content);
    setAttachments(item.attachments);
    setSkillId(item.skillId);
  }
  function restoreDraft(value: PromptDraft) {
    setDraft(value.prompt);
    setAttachments(value.attachments);
    setSkillId(value.skillId);
  }
  function cancelQueuedEdit() {
    if (!queuedEdit) return;
    setQueuedEdit(undefined);
    restoreDraft(queuedEdit.saved);
  }
  async function saveQueuedEdit(): Promise<boolean> {
    if (!queuedEdit || !sessionId) return false;
    if (!draft.trim() && attachments.length === 0) {
      setNotice("A queued message needs text. Remove it from the queue instead.");
      return false;
    }
    try {
      setFollowUps(await api.updateFollowUps(sessionId, { type: "replace", id: queuedEdit.id, prompt: { content: draft, attachments, ...(skillId ? { skillId } : {}) } }));
    } catch (error) {
      setNotice(formatUserError(error));
      return false;
    }
    cancelQueuedEdit();
    return true;
  }
  /*
   * The prompt went out while it was open here. An untouched edit just ends;
   * a changed one stays in the composer as a new draft, and the draft it had
   * set aside goes to Stash rather than being lost.
   */
  useEffect(() => {
    if (!queuedEdit || queue.some((item) => item.id === queuedEdit.id)) return;
    setQueuedEdit(undefined);
    const changed = draft !== queuedEdit.original.prompt || attachments.length !== queuedEdit.original.attachments.length || skillId !== queuedEdit.original.skillId;
    if (!changed) { restoreDraft(queuedEdit.saved); return; }
    const aside = queuedEdit.saved;
    if (aside.prompt.trim() || aside.attachments.length || aside.skillId) {
      const recovery = recoverFailedPrompt(localStorage, latestStashes.current, { ...aside, projectId });
      latestStashes.current = recovery.entries;
      setPromptStashes(recovery.entries);
    }
    setNotice("That queued message was sent before your edit was saved. Your edit is still in the composer as a new message.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, queuedEdit]);
  async function steerQueued(id: string) {
    const item = queue.find((entry) => entry.id === id);
    if (!item || !sessionId) return;
    try {
      await api.steerHarness(sessionId, item.content);
      await changeFollowUps({ type: "remove", id });
      await refresh();
      await loadSession(sessionId);
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function createProject() {
    if (!newProjectName.trim()) return;
    const created = await api.createProject({ name: newProjectName.trim() });
    setNewProjectName("");
    setProjectId(created.id);
    await refresh();
  }

  function folderName(directory: string): string {
    return folderBasename(directory) || "Project";
  }

  async function pickProjectDirectory(id = projectId) {
    try {
      const directory = await api.pickDirectory();
      if (!directory) return;
      const name = folderName(directory);
      const target = id ?? projects[0]?.id;
      const current = projects.find((item) => item.id === target);
      if (!target || current?.name === "Inbox") {
        const created = await api.createProject({ name, workingDirectory: directory });
        setProjectId(created.id);
      } else {
        await api.updateProject(target, { workingDirectory: directory });
      }
      setView("chat");
      setNotice(undefined);
      await refresh();
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function pickFilesToMention() {
    try {
      const paths = await api.pickFiles() as string[] | undefined;
      if (!paths?.length) return;
      const first = paths[0];
      if (!first) return;
      let root = project?.workingDirectory;
      if (!root) {
        const parent = parentFolder(first);
        const target = projectId ?? projects[0]?.id;
        if (!target) {
          const created = await api.createProject({
            name: folderName(parent),
            workingDirectory: parent,
          });
          setProjectId(created.id);
        } else {
          await api.updateProject(target, { workingDirectory: parent });
        }
        root = parent;
        await refresh();
      }
      for (const absolute of paths) {
        mentionFile(fileMentionTarget(root, absolute));
      }
      setView("chat");
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function attachFiles(paths: string[]) {
    const existing = new Set(attachmentState.current.value.map((item) => item.path));
    const unique = [...new Set(paths)].filter((path) => !existing.has(path));
    return prepareAttachments(unique.length, async () => unique);
  }

  /** Reserve slots before clipboard writes or validation can yield. */
  async function prepareAttachments(count: number, resolvePaths: () => Promise<string[]>, context?: MessageAttachment["context"]) {
    if (!draftScopes.isCurrent(draftScope) || !count) return false;
    const pending = attachmentReservations.get(draftScope) ?? 0;
    const over = attachmentState.current.value.length + pending + count - MAX_ATTACHMENTS;
    if (over > 0) {
      setNotice(tooManyAttachments(over));
      return false;
    }
    attachmentReservations.set(draftScope, pending + count);
    setPreparingAttachments(pending + count);
    try {
      const paths = await resolvePaths();
      if (!paths?.length) return false;
      const validated: MessageAttachment[] = await api.validateAttachments(
        paths.map((filePath) => ({
          name: folderBasename(filePath) ?? filePath,
          path: filePath,
        })),
      );
      if (!draftScopes.isCurrent(draftScope)) return false;
      const existing = new Set(attachmentState.current.value.map((item) => item.path));
      const over = new Set([...existing, ...validated.map((item) => item.path)]).size - MAX_ATTACHMENTS;
      if (over > 0) throw new Error(tooManyAttachments(over));
      setAttachments((current) => {
        const byPath = new Map(current.map((item) => [item.path, item]));
        for (const item of validated) byPath.set(item.path, context ? { ...item, context } : item);
        return [...byPath.values()];
      });
      setNotice(undefined);
      return true;
    } catch (error) {
      setNotice(formatUserError(error));
      return false;
    } finally {
      const remaining = Math.max(0, (attachmentReservations.get(draftScope) ?? count) - count);
      attachmentReservations.set(draftScope, remaining);
      setPreparingAttachments(remaining);
    }
  }

  /**
   * Attach whatever image the clipboard is holding.
   *
   * A pasted screenshot is bitmap data, not a file, so there is no path for
   * attachFiles to take. The main process writes it out and hands back one.
   * Returns false when the clipboard held no image, so the composer can let an
   * ordinary text paste through untouched.
   */
  async function attachImage(png: Uint8Array): Promise<boolean> {
    return prepareAttachments(1, async () => [await api.saveImageAttachment(png)]);
  }

  async function attachClipboardImage(): Promise<boolean> {
    return prepareAttachments(1, async () => {
      const saved = (await api.saveClipboardImage()) as string | undefined;
      return saved ? [saved] : [];
    });
  }

  async function attachPastedText(text: string): Promise<boolean> {
    const accepted = await prepareAttachments(1, async () => [await api.saveTextAttachment(text)]);
    if (!accepted) {
      const recovery = recoverFailedPrompt(localStorage, latestStashes.current, { prompt: text, attachments: [], projectId });
      latestStashes.current = recovery.entries;
      setPromptStashes(recovery.entries);
      setNotice(`Pasted text could not be attached. It is ${recovery.persisted ? "saved" : "kept temporarily until the app closes"} in Stash; your draft is unchanged.`);
    }
    return accepted;
  }

  async function pickAttachments() {
    try {
      const paths = await api.pickFiles() as string[] | undefined;
      if (paths?.length && draftScopes.isCurrent(draftScope)) await attachFiles(paths);
    } catch (error) { setNotice(formatUserError(error)); }
  }

  async function attachContext(resolved: ResolvedContext): Promise<boolean> {
    return prepareAttachments(1, async () => [await api.saveTextAttachment(resolved.text, resolved.fileName)], resolved.context);
  }

  function removeAttachment(filePath: string) {
    setAttachments((current) => current.filter((item) => item.path !== filePath));
  }

  function stashCurrentPrompt() {
    try {
      const next = stashPrompt(localStorage, promptStashes, {
        prompt: draft,
        attachments,
        skillId,
        projectId,
      });
      if (next === promptStashes) {
        if (draft.trim() || attachments.length > 0 || skillId) setNotice("Could not save the prompt stash.");
        return;
      }
      setPromptStashes(next);
      setDraft("");
      setAttachments([]);
      setSkillId(undefined);
      toasts.show({ key: "stash", tone: "success", title: "Prompt stashed", detail: "Press ⌘S with an empty composer to open the stash." });
    } catch {
      setNotice("Could not save the prompt stash.");
    }
  }

  function restorePromptStash(id: string) {
    const entry = promptStashes.find((item) => item.id === id);
    if (!entry) return;
    const next = promptStashes.filter((item) => item.id !== id);
    try {
      writePromptStash(localStorage, next);
    } catch {
      // Keep the in-memory restore useful even if persistence is unavailable.
    }
    setPromptStashes(next);
    setDraft(entry.prompt);
    setAttachments(entry.attachments);
    setSkillId(entry.skillId);
    setNotice(undefined);
  }

  function deletePromptStash(id: string) {
    const next = promptStashes.filter((item) => item.id !== id);
    try {
      writePromptStash(localStorage, next);
    } catch {
      // The current session can still remove it even when storage is blocked.
    }
    setPromptStashes(next);
  }

  async function createProjectFromFolder() {
    try {
      const directory = await api.pickDirectory();
      if (!directory) return;
      const name = newProjectName.trim() || folderName(directory);
      const created = await api.createProject({
        name,
        workingDirectory: directory,
      });
      setNewProjectName("");
      setProjectId(created.id);
      setView("chat");
      await refresh();
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function cloneRepository(input: CloneRepositoryInput) {
    setNotice(undefined);
    try {
      const created = await api.cloneRepository(input) as Project;
      setProjectId(created.id);
      setSessionId(undefined);
      setView("chat");
      await refresh();
    } catch (error) {
      setNotice(formatUserError(error));
      throw error;
    }
  }

  async function applyFolderPatch(
    targetId: string,
    patch: { workingDirectory?: string; extraFolders: string[]; },
  ) {
    await api.updateProject(targetId, {
      workingDirectory: patch.workingDirectory ?? null,
      extraFolders: patch.extraFolders,
    });
    await refresh();
  }

  async function addProjectFolder(id = projectId) {
    try {
      const directory = await api.pickDirectory();
      if (!directory || !id) return;
      const current = projects.find((item) => item.id === id);
      if (!current || current.name === "Inbox") {
        const created = await api.createProject({
          name: folderName(directory),
          workingDirectory: directory,
        });
        setProjectId(created.id);
        await refresh();
        setView("chat");
        return;
      }
      await applyFolderPatch(id, addFolderToProject(current, directory));
      setView("chat");
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function removeProjectFolder(path: string, id = projectId) {
    if (!id) return;
    const current = projects.find((item) => item.id === id);
    if (!current) return;
    await applyFolderPatch(id, removeFolderFromProject(current, path));
  }

  async function makePrimaryFolder(path: string, id = projectId) {
    if (!id) return;
    const current = projects.find((item) => item.id === id);
    if (!current) return;
    await applyFolderPatch(id, promoteProjectFolder(current, path));
  }

  async function renameProject(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    await api.updateProject(id, { name: trimmed });
    await refresh();
  }

  function deleteProject(id: string) {
    const target = projects.find((item) => item.id === id);
    setConfirm({
      title: `Delete “${target?.name ?? "project"}”?`,
      detail: "Conversations, runs, and artifacts in this project are removed. The folder on disk is not deleted.",
      danger: true,
      confirmLabel: "Delete project",
      onConfirm: () => {
        void (async () => {
          await api.deleteProject(id);
          if (projectId === id) setProjectId(undefined);
          setConfirm(undefined);
          await refresh();
        })();
      },
    });
  }

  /* Never rejects: an empty title or a failed write is said, and the old title stays. */
  async function renameSession(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) {
      setNotice("A conversation needs a title. It keeps its old one.");
      return false;
    }
    if (sessions.find((item) => item.id === id)?.title === trimmed) return true;
    try {
      await api.renameSession(id, trimmed);
    } catch (error) {
      setNotice(`Could not rename the conversation. ${formatUserError(error)}`);
      return false;
    }
    await refresh();
    return true;
  }

  function deleteSession(id: string) {
    const target = sessions.find((item) => item.id === id);
    const remove = async () => {
      try {
        await api.deleteSession(id);
        if (sessionId === id) setSessionId(undefined);
        setConfirm(undefined);
        await refresh();
      } catch (error) { setNotice(formatUserError(error)); }
    };
    // Settings › General › Confirm before deleting. A project's deletion always asks: it takes every conversation with it.
    if (settings?.confirmDelete === false) { void remove(); return; }
    setConfirm({
      title: `Delete “${target?.title ?? "conversation"}”?`,
      detail: "Messages and runs in this conversation are removed.",
      danger: true,
      confirmLabel: "Delete",
      onConfirm: () => void remove(),
    });
  }

  async function archiveSession(id: string, confirmed = false) {
    // Settings › General › Confirm before archiving; off by default, since Archive offers Undo.
    if (settings?.confirmArchive && !confirmed) {
      const target = sessions.find((item) => item.id === id);
      setConfirm({
        title: `Archive “${target?.title ?? "conversation"}”?`,
        detail: "It leaves the sidebar. History keeps it, and Restore brings it back.",
        confirmLabel: "Archive",
        onConfirm: () => { setConfirm(undefined); void archiveSession(id, true); },
      });
      return;
    }
    if (archiving.current.has(id)) return;
    archiving.current.add(id);
    try {
      const archived = await api.archiveSession(id);
      if (currentSelection.current.sessionId === id) setSessionId(undefined);
      toasts.show({
        key: `archive:${id}`,
        title: `Archived “${archived.title}”`,
        action: { label: "Undo", undo: true, run: () => restoreSession(id) },
      });
      await refresh();
    } catch (error) { setNotice(formatUserError(error)); }
    finally { archiving.current.delete(id); }
  }

  async function restoreSession(id: string) {
    if (restoring.current.has(id)) return;
    restoring.current.add(id);
    try {
      await api.restoreSession(id);
      toasts.dismissKey(`archive:${id}`);
      await refresh();
    } catch (error) { setNotice(formatUserError(error)); }
    finally { restoring.current.delete(id); }
  }

  async function openTerminal() {
    if (!projectId) return;
    try {
      if (!project?.workingDirectory) {
        const directory = await api.pickDirectory();
        if (!directory) return;
        await api.updateProject(projectId, { workingDirectory: directory });
        await refresh();
      }
      await api.openTerminal(projectId, sessionId);
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function initializeGit() {
    if (!projectId) return;
    if (await performGit(() => api.gitInit(projectId))) {
      toasts.show({ key: "git-init", tone: "success", title: "Git initialized", detail: "Create the first commit before using worktree conversations." });
    }
  }

  async function saveProjectActions(actions: ProjectAction[]) {
    if (!projectId) return { saved: false as const, error: "Select a project before saving an action." };
    try {
      const declared = project?.projectFile?.status === "ok" ? project.projectFile.file.actions : [];
      await api.updateProject(projectId, { actions: projectActionOverrides(declared, actions) });
      setNotice(undefined);
      await refresh();
      return { saved: true as const };
    } catch (error) {
      const message = formatUserError(error);
      setNotice(message);
      return { saved: false as const, error: message };
    }
  }

  /*
   * An action runs in the terminal dock, in a tab named after it, so its
   * output stays live and Control-C stops it. A paired viewer has no shell.
   */
  function runProjectAction(action: ProjectAction) {
    if (!project) return;
    if (api.isDesktop === false) {
      setNotice("Project actions run in the terminal on the computer running Capsule.");
      return;
    }
    rememberLastAction(project.id, action.id);
    requestTerminalCommand({ kind: "run", command: action.command, tab: { key: `${project.id}:${action.id}`, label: action.name } });
    setView("chat");
    setTerminalOpen(true);
    if (action.previewUrl && action.openPreview !== false) {
      setBrowserUrl(action.previewUrl);
      openInspector("browser");
    }
  }

  async function setWorkspaceMode(mode: WorkspaceMode) {
    const previous = workspaceMode;
    setWorkspaceModeState(mode);
    if (!sessionId) return;
    try {
      await api.setSessionWorkspaceMode(sessionId, mode);
      setNotice(undefined);
      await refresh();
    } catch (error) {
      setWorkspaceModeState(previous);
      setNotice(formatUserError(error));
    }
  }

  async function setWorktreeBase(ref: string) {
    if (!sessionId) return;
    try {
      await api.setSessionWorktreeBase(sessionId, ref);
      setNotice(undefined);
      await refresh();
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function startPullRequestThread(input: Omit<StartPullRequestInput, "projectId">) {
    if (!projectId) throw new Error("Select a project first.");
    const targetProject = projectId;
    const started = await api.startPullRequestThread({ ...input, projectId: targetProject });
    promotedDrafts.current.set(promptDraftKey(targetProject, started.session.id), { prompt: started.draft, attachments: [] });
    setProjectId(targetProject);
    setSessionId(started.session.id);
    setView("chat");
    await refresh();
    return { detail: started.detail };
  }

  async function openPath(target: string) {
    await api.openPath(target);
  }

  function mentionFile(relative: string) {
    setDraft((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${relative} `);
    setMode((current) => (current === "chat" ? "code" : current));
  }

  async function spawnHarness(
    harnessId: string,
    prompt?: string,
    options?: { mode?: "persistent" | "oneshot"; },
  ) {
    if (!projectId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await api.spawnHarness({
        projectId,
        harnessId,
        prompt,
        cwd: session?.workingDirectory ?? project?.workingDirectory,
        mode: options?.mode ?? "persistent",
        permissionProfile:
          session?.permissionProfile === "strict" ||
          session?.permissionProfile === "approve-all" ||
          session?.permissionProfile === "default"
            ? (session.permissionProfile as HarnessPermissionProfile)
            : projectSettings?.defaultPermission,
      });
      setSessionId(result.session.id);
      setAgentId(harnessId);
      setMode("code");
      setView("chat");
      if (result.usedSlashCommand === false && result.detail) setNotice(result.detail);
      await refresh();
    } catch (error) {
      setNotice(formatUserError(error));
    } finally {
      setBusy(false);
    }
  }

  async function dedicateHarness(harnessId: string) {
    if (!projectId) return;
    await api.dedicateHarness(projectId, harnessId);
    setAgentId(harnessId);
    setMode("code");
    await refresh();
  }

  async function undedicateHarness() {
    if (!projectId) return;
    await api.undedicateHarness(projectId);
    await refresh();
  }

  async function doctorHarness(harnessId: string) {
    try {
      const report = await api.doctorHarness(harnessId);
      setDoctors((current) => ({ ...current, [harnessId]: report }));
      const name = harnessDisplayName(harnesses, harnessId);
      // The full report, with each check's detail, is in the Agents view.
      if (report.ready) {
        setNotice((current) => current?.startsWith(`${name} still can't start`) ? undefined : current);
        showToast({ key: `doctor:${harnessId}`, tone: "success", title: `${name} is ready.` });
      } else {
        const failing = report.checks.find((item: { ok: boolean; label: string }) => !item.ok)?.label;
        setNotice(`${name} still can't start${failing ? `: ${failing}` : ""}. Open Agents to see the full check.`);
      }
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function cancelHarness(id?: string) {
    const target = id ?? sessionId;
    if (!target) return;
    try {
      await api.cancelHarness(target);
      await refresh();
      await loadSession(target);
    } catch (error) { setNotice(formatUserError(error)); }
  }

  async function steerHarness() {
    if (!sessionId) return;
    const submission = steering.begin(steeringKey);
    if (!submission) return;
    renderSteering((version) => version + 1);
    let accepted = false;
    try {
      await api.steerHarness(sessionId, submission.text);
      accepted = true;
      await refresh();
      await loadSession(sessionId);
    } catch (error) {
      setNotice(accepted ? `Steering was sent, but the view could not refresh: ${formatUserError(error)}` : formatUserError(error));
    } finally {
      submission.finish(accepted);
      renderSteering((version) => version + 1);
    }
  }

  async function closeHarness(id?: string) {
    const target = id ?? sessionId;
    if (!target) return;
    try {
      await api.closeHarness(target);
      await refresh();
    } catch (error) { setNotice(formatUserError(error)); }
  }

  /*
   * Read a live harness's status into the cache and nothing else.
   *
   * refreshHarnessStatus also reloads the whole workspace, which is right for
   * a button press and far too much for "the composer would like to know which
   * models this agent offers".
   */
  async function loadHarnessStatus(id: string) {
    try {
      await readHarnessStatus(id);
    } catch {
      // A status we could not read means no model list, not a broken thread.
    }
  }

  async function readHarnessStatus(id: string, force = false) {
    const context = statusContext.current;
    const thread = context.sessions.find((item) => item.id === id);
    if (!thread) return;
    const project = context.projects.find((item) => item.id === thread.projectId);
    const changed = await statusCache.load(thread, project, () => api.harnessStatus(id), () => {
      const current = statusContext.current;
      const live = current.sessions.find((item) => item.id === id);
      return live ? harnessStatusIdentity(live, current.projects.find((item) => item.id === live.projectId)) : undefined;
    }, force);
    if (changed) renderStatus((value) => value + 1);
  }

  async function refreshHarnessStatus(id?: string) {
    const target = id ?? sessionId;
    if (!target) return;
    await readHarnessStatus(target, true);
    await refresh();
  }

  async function setHarnessOption(
    key: "model" | "permissions" | "cwd" | "mode" | "timeout",
    value: string,
    targetSessionId?: string,
  ) {
    const target = targetSessionId ?? sessionId;
    if (!target) return;
    try {
      await api.setHarnessOption({ sessionId: target, key, value });
      if (harnessStatuses[target]) {
        await refreshHarnessStatus(target);
      } else {
        await refresh();
      }
    } catch (error) { setNotice(formatUserError(error)); }
  }

  async function stopRun() {
    if (!activeRun || stoppingRuns.current.has(activeRun.id)) return;
    const runId = activeRun.id;
    stoppingRuns.current.add(runId);
    setStoppingRunIds([...stoppingRuns.current]);
    try {
      await api.stopRun(runId);
      await refresh();
    } catch (error) {
      const detail = formatUserError(error);
      // The agent may still be working; Force stop ends its process, which a stop could not.
      if (UNCONFIRMED_STOP.test(detail) && (api.isDesktop !== false || api.remoteMode === "control")) {
        showToast({
          key: `stop:${runId}`, tone: "error", timeoutMs: 0,
          title: "The agent hasn't confirmed it stopped.",
          detail: "It may still be working. Force stop ends it.",
          action: { label: "Force stop", run: () => forceStopRun(runId) },
        });
      } else setNotice(detail);
    }
    finally { stoppingRuns.current.delete(runId); setStoppingRunIds([...stoppingRuns.current]); }
  }

  async function forceStopRun(runId: string) {
    try {
      await api.forceStopRun(runId);
      await refresh();
    } catch (error) { setNotice(formatUserError(error)); }
  }

  /* Unpinning drops the thread's place among the pins, so Undo puts the order back too. */
  async function pinSession(id: string, pinned: boolean) {
    const target = sessions.find((item) => item.id === id);
    const before = sessions.filter((item) => item.projectId === target?.projectId && item.pinned)
      .sort((a, b) => (a.pinOrder ?? Number.MAX_SAFE_INTEGER) - (b.pinOrder ?? Number.MAX_SAFE_INTEGER)).map((item) => item.id);
    try {
      await api.pinSession(id, pinned);
    } catch (error) {
      setNotice(formatUserError(error));
      return;
    }
    if (!pinned && target?.pinned) {
      toasts.show({
        key: `unpin:${id}`,
        title: `Unpinned “${target.title}”`,
        action: { label: "Undo", undo: true, run: () => restorePin(id, target.projectId, before) },
      });
    } else toasts.dismissKey(`unpin:${id}`);
    await refresh();
  }

  async function restorePin(id: string, targetProjectId: string, before: readonly string[]) {
    try {
      await api.pinSession(id, true);
      const pinnedNow = (await api.listSessions(targetProjectId)).filter((item: Session) => item.pinned);
      const order = restoredPinOrder(before, pinnedNow);
      if (order.join() !== pinnedNow.map((item: Session) => item.id).join()) await api.reorderPinnedSessions(targetProjectId, order);
    } catch (error) {
      setNotice(formatUserError(error));
    }
    await refresh();
  }

  async function reorderPinnedSessions(targetProjectId: string, orderedIds: string[]) {
    await api.reorderPinnedSessions(targetProjectId, orderedIds);
    await refresh();
  }

  async function regenerateTitle(id: string) {
    await api.regenerateTitle(id);
    await refresh();
  }

  async function setPermissionProfile(profile: string) {
    if (!sessionId) return;
    try {
      await api.setPermissionProfile(sessionId, profile);
      await refresh();
    } catch (error) { setNotice(formatUserError(error)); }
  }

  async function sendAndContinue() {
    await send(true);
  }

  async function checkoutBranch(branch: string) {
    if (!projectId) return;
    await performGit(() => api.checkoutBranch(projectId, branch, sessionId));
  }

  function openInspector(tab?: InspectorTab) {
    if (tab) setInspectorTab(tab);
    setInspectorOpen(true);
    setView("chat");
  }

  async function setConfigValue(input: SetConfigValueInput): Promise<ConfigSnapshot> {
    const snapshot = await api.configSetValue({ ...input, projectId: input.projectId ?? projectId });
    configLoad.current++;
    setConfigView((current) => current && { ...current, snapshot });
    setSettings(snapshot.settings);
    applyAppearance(snapshot.settings, snapshot.themes);
    return snapshot;
  }

  async function updateSettings(patch: Partial<CapsuleSettings>) {
    const next = await api.updateSettings(patch) as CapsuleSettings;
    setSettings(next);
    applyAppearance(next);
    if (patch.defaultAgentId) setAgentId(patch.defaultAgentId);
    if (patch.defaultWorkspaceMode) setWorkspaceModeState(patch.defaultWorkspaceMode);
    return next;
  }

  const { favorites: favoriteModels, toggleFavorite: toggleFavoriteModel } = useFavoriteModels(settings, updateSettings, api.isDesktop !== false);

  async function actOnPlan() {
    if (await setTurnMode("act")) await send(false, ACT_ON_PLAN_PROMPT);
  }

  async function keepPlanning() {
    if (turnMode !== "plan" && !await setTurnMode("plan")) return;
    document.querySelector<HTMLTextAreaElement>(".composer textarea[aria-label='Message']")?.focus();
  }

  async function performGit(operation: () => Promise<GitStatus>): Promise<boolean> {
    if (!requests.isCurrent(scope)) return false;
    const current = requests.capture("git");
    try {
      const next = await operation();
      if (!current()) return requests.isCurrent(scope);
      setGit(next);
      setGitError(undefined);
      setNotice(undefined);
      return true;
    } catch (error) {
      if (requests.isCurrent(scope)) setNotice(formatUserError(error));
      return false;
    }
  }

  async function gitCommit(message: string, scope?: GitCommitScope) {
    return projectId ? performGit(() => api.gitCommit(projectId, message, sessionId, scope)) : false;
    }

  async function gitStage(relative: string) {
    if (projectId) await performGit(() => api.gitStage(projectId, relative, sessionId));
  }

  function gitDiscard(relative: string) {
    setConfirm({
      title: `Discard “${relative}”?`,
      detail: "Uncommitted edits in this file are removed.",
      danger: true,
      confirmLabel: "Discard",
      onConfirm: () => {
        void (async () => {
          if (!projectId) return;
          await performGit(() => api.gitDiscard(projectId, relative, sessionId));
          setConfirm(undefined);
        })();
      },
    });
  }

  async function gitApplyHunk(apply: HunkApply) {
    if (!projectId) return;
    const current = requests.capture("git");
    const next = await api.gitApplyHunk(projectId, apply, sessionId);
    if (current()) setGit(next);
  }

  async function gitCreateBranch(branch: string) {
    return projectId ? performGit(() => api.gitCreateBranch(projectId, branch, sessionId)) : false;
  }

  async function gitPush(options?: { toDefaultBranch?: boolean; }) {
    return projectId ? performGit(() => api.gitPush(projectId, sessionId, options?.toDefaultBranch)) : false;
  }

  async function gitPull(mode: GitPullMode = "ff-only") {
    return projectId ? performGit(() => api.gitPull(projectId, sessionId, mode)) : false;
  }

  async function gitCreatePullRequest(input?: { title?: string; body?: string; }) {
    return projectId ? performGit(() => api.gitCreatePullRequest(projectId, { ...input, sessionId })) : false;
  }

  async function gitMergePullRequest() {
    if (projectId) await performGit(() => api.gitMergePullRequest(projectId, sessionId, git?.pullRequest?.url));
  }

  async function gitMergePullRequestStack(action: GitPullRequestStackAction) {
    return projectId
      ? performGit(() => api.gitMergePullRequestStack(projectId, action, sessionId) as Promise<GitStatus>)
      : false;
  }

  async function gitRebasePullRequestStack(action: GitPullRequestStackAction) {
    return projectId
      ? performGit(() => api.gitRebasePullRequestStack(projectId, action, sessionId) as Promise<GitStatus>)
      : false;
  }

  const installSkill = useCallback(
    async (skill: Skill) => {
      const result = await api.installSkill(skill) as Skill;
      await refresh();
      return result;
    },
    [api, refresh],
  );

  const uninstallSkill = useCallback(
    async (skillId: string) => {
      await api.uninstallSkill(skillId);
      await refresh();
    },
    [api, refresh],
  );

  const resetSettingsSection = useCallback(
    async (section: string) => {
      await api.resetSettingsSection(section);
      await refresh();
    },
    [api, refresh],
  );

  const searchSkillCatalog = useCallback(
    async (query: string, refresh?: boolean) => {
      return await api.searchSkillCatalog(query, refresh) as SkillCatalogPage;
    },
    [api],
  );

  const fetchSkillDetail = useCallback(
    async (id: string) => {
      return await api.fetchSkillDetail(id) as string | undefined;
    },
    [api],
  );

  // The harness reports this as activity text; nothing else parses it.
  const contextUsage = useMemo(
    () => contextUsageFromEvents(events),
    [events],
  );

  const steps = useMemo(() => activityFromEvents(events, !activeRun || activeRun.status !== "running", {
    reasoning: projectSettings?.reasoningSummary,
  }), [events, activeRun?.status, projectSettings?.reasoningSummary]);

  /* ⌃Tab reads the latest list and selection, not the ones its key handler closed over. */
  /* ⌃Tab and ⌘1–9 follow the sidebar as drawn, so they reach what the person can see. */
  const openSidebarThread = (id: string | undefined) => {
    const next = sessions.find((item) => item.id === id && item.state === "active");
    if (!next) return;
    if (next.id !== sessionId) {
      applyProjectDefaults(projects.find((item) => item.id === next.projectId));
      setProjectId(next.projectId);
      setSessionId(next.id);
    }
    setView("chat");
  };
  cycleSession.current = (step) => {
    const next = adjacentSession(sidebarOrder(), sessionId, step);
    if (next !== sessionId) openSidebarThread(next);
  };

  const commands = useCommandList(api, projectId);

  /*
   * What a key binding runs: a registry command, a Capsule command (put in
   * the composer as the `/` menu would), a project action by name, or a
   * profile, which starts a new conversation from it.
   */
  const runKeyAction = (action: string) => {
    const { namespace, name } = parseKeymapAction(action);
    if (namespace === "command") {
      if (!commands.list?.commands.some((command) => command.name === name)) {
        setNotice(`There is no /${name} command.`);
        return;
      }
      setView("chat");
      window.dispatchEvent(new CustomEvent(INSERT_COMMAND_EVENT, { detail: { text: `/${name} ` } }));
      return;
    }
    if (namespace === "profile") {
      if (!config?.profiles.some((profile) => profile.id === name)) {
        setNotice(`There is no profile named ${name}.`);
        return;
      }
      void startWithProfile(name);
      return;
    }
    if (namespace === "action") {
      const found = project?.actions?.find((item) => item.name === name || item.id === name);
      if (!project || !found) {
        setNotice(`This project has no action named ${name}.`);
        return;
      }
      runProjectAction(found);
      return;
    }
    const row = jumpCommandIndex(name);
    if (row !== undefined) {
      // The open model picker numbers its own rows; its handler takes the key there.
      if (!document.activeElement?.closest(".agent-model-picker")) openSidebarThread(sidebarOrder()[row]);
      return;
    }
    switch (name) {
      case "search-files":
        setFilePicker((open) => !open);
        break;
      case "search-in-files":
        setContentSearch((open) => !open);
        break;
      case "toggle-sidebar":
        setSidebarCollapsed((open) => !open);
        break;
      case "toggle-inspector":
        setInspectorOpen((open) => !open);
        break;
      case "toggle-terminal":
        setTerminalOpen((open) => !open);
        break;
      case "history-back":
        goBack();
        break;
      case "history-forward":
        goForward();
        break;
      case "find-in-thread":
        // In the browser pane, ⌘F finds on the page rather than in the thread.
        if (document.activeElement?.closest(".panel-browser-pane")) window.dispatchEvent(new CustomEvent(BROWSER_FIND_EVENT));
        else if (document.activeElement?.closest(".panel-file-tree-pane")) window.dispatchEvent(new CustomEvent(FILES_FIND_EVENT));
        else setThreadFind((open) => !open);
        break;
      case "jump-to-prompt":
        setView("chat");
        setPromptJump((open) => !open);
        break;
      case "open-review":
      case "open-browser": {
        const tab = name === "open-review" ? "changes" : "browser";
        // Pressed again on its own surface, the key closes the panel.
        if (inspectorOpen && inspectorTab === tab) setInspectorOpen(false);
        else {
          setInspectorTab(tab);
          setInspectorOpen(true);
        }
        break;
      }
      case "stop-turn":
        if (!activeRun) setNotice("Nothing is running in this conversation.");
        else if (api.isDesktop === false && api.remoteMode !== "control") setNotice("This device can only read.");
        else void stopRun();
        break;
      case "focus-composer":
        setView("chat");
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea.composer-field")?.focus());
        break;
      case "next-conversation":
      case "previous-conversation":
        cycleSession.current(name === "next-conversation" ? 1 : -1);
        break;
      case "show-shortcuts":
        window.dispatchEvent(new CustomEvent(SHOW_SHORTCUTS_EVENT));
        break;
      case "cycle-favorite-model":
        window.dispatchEvent(new CustomEvent(CYCLE_FAVORITE_MODEL_EVENT));
        break;
      case "open-in-favorite":
        window.dispatchEvent(new CustomEvent(OPEN_IN_EVENT));
        break;
      case "dictation":
        window.dispatchEvent(new CustomEvent(TOGGLE_DICTATION_EVENT));
        break;
      case "open-mode":
      case "open-model":
      case "open-effort": {
        const reason = openComposerControl(name.slice("open-".length) as ComposerControl);
        if (reason) setNotice(reason);
        break;
      }
      case "clear-backdrop":
        void api.configSetValue({ key: "theme", value: clearedBackdrop(configView?.snapshot.themes.selection), scope: "user" }).catch((error: unknown) => setNotice(formatUserError(error)));
        break;
      default:
        // Commands owned below the workspace, such as triage and the closed panel, listen for this.
        window.dispatchEvent(new CustomEvent(KEY_COMMAND_EVENT, { detail: { id: name } }));
    }
  };
  const keyChordPending = useKeymap(keyBindings, runKeyAction);

  /* An agent turned off in Agents is hidden from every list but that one, where it can be turned back on. */
  const agentOverrides = settings?.agentOverrides;
  const shownHarnesses = useMemo(() => harnesses.filter((item) => agentEnabled(agentOverrides, item.id)), [harnesses, agentOverrides]);
  const shownAgents = useMemo(() => agents.filter((item) => agentEnabled(agentOverrides, item.id)), [agents, agentOverrides]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      api,
      commands,
      keyBindings,
      keyChordPending,
      view,
      setView,
      settingsTab,
      setSettingsTab,
      resetSettingsSection,
      status,
      subsystems,
      projects,
      sessions,
      agents: shownAgents,
      skills,
      installSkill,
      uninstallSkill,
      searchSkillCatalog,
      fetchSkillDetail,
      aboutOpen,
      setAboutOpen,
      messages,
      historyLoad,
      hasOlderMessages: hasOlderMessages || transcript.olderEvicted,
      hasNewerMessages: transcript.hasNewer,
      returnToLatest,
      reloadThread,
      loadingOlder,
      loadOlderMessages,
      runs,
      events,
      eventLoad,
      artifacts,
      approvals,
      harnesses: shownHarnesses,
      allHarnesses: harnesses,
      harnessSessions,
      doctors,
      harnessStatuses,
      loadHarnessStatus,
      projectId,
      sessionId,
      agentId,
      mode,
      draft,
      attachments,
      preparingAttachments,
      attachPastedText,
      promptStashes,
      busy,
      sendBlockReason,
      agentCommandsOpen,
      palette,
      paletteQuery,
      newProjectName,
      notice,
      setNotice,
      steerDraft,
      project,
      session,
      activeRun,
      pendingApproval,
      pendingApprovals,
      connected,
      steps,
      contextUsage,
      git,
      gitError,
      files,
      confirm,
      setConfirm,
      setProjectId: (id: string, nextSessionId?: string) => {
        applyProjectDefaults(projects.find((item) => item.id === id));
        setProjectId(id);
        if (nextSessionId) {
          setSessionId(nextSessionId);
          return;
        }
        if (sessions.find((item) => item.id === sessionId)?.projectId === id) return;
        const first = sessions.find((item) => item.projectId === id && item.state === "active");
        setSessionId(first?.id);
      },
      setSessionId,
      canGoBack: navigationCanGoBack(navigation),
      canGoForward: navigationCanGoForward(navigation),
      goBack,
      goForward,
      setAgentId,
      setMode,
      setDraft,
      pickAttachments,
      attachClipboardImage,
      attachImage,
      attachFiles,
      attachContext,
      sendPrompt: (text: string) => send(false, text),
      removeAttachment,
      stashCurrentPrompt,
      restorePromptStash,
      deletePromptStash,
      setPalette,
      setPaletteQuery,
      setNewProjectName,
      setSteerDraft,
      steeringPending,
      refresh,
      loadSession,
      createTask,
      startWithProfile,
      send,
      sendFollowUp: (how: "steer" | "queue") => send(false, undefined, how),
      createProject,
      pickProjectDirectory,
      pickFilesToMention,
      createProjectFromFolder,
      cloneRepository,
      addProjectFolder,
      removeProjectFolder,
      makePrimaryFolder,
      renameProject,
      deleteProject,
      renameSession,
      deleteSession,
      archiveSession: (id: string) => archiveSession(id),
      restoreSession,
      openTerminal,
      initializeGit,
      saveProjectActions,
      runProjectAction,
      workspaceMode,
      setWorkspaceMode,
      setWorktreeBase,
      startPullRequestThread,
      browserUrl,
      setBrowserUrl,
      projectRuns,
      openPath,
      mentionFile,
      spawnHarness,
      draftHarnessConfig,
      setDraftHarnessConfig,
      dedicateHarness,
      undedicateHarness,
      doctorHarness,
      cancelHarness,
      steerHarness,
      closeHarness,
      refreshHarnessStatus,
      setHarnessOption,
      ready,
      startupError,
      sidebarCollapsed,
      inspectorOpen,
      terminalOpen,
      setTerminalOpen,
      sidebarWidth,
      setSidebarCollapsed,
      setInspectorOpen,
      setSidebarWidth,
      toggleSidebar: () => setSidebarCollapsed((value) => !value),
      toggleInspector: () => setInspectorOpen((value) => !value),
      stopRun,
      forceStopRun,
      stoppingRunIds,
      skillId,
      setSkillId,
      filePicker,
      setFilePicker,
      pinSession,
      reorderPinnedSessions,
      regenerateTitle,
      setPermissionProfile,
      draftApproval,
      setDraftApproval,
      sendAndContinue,
      setAgentCommandsOpen,
      runAgentCommand: async (name, input = "") => {
        if (api.isDesktop === false) { setNotice("Agent commands can only be sent from the desktop app."); return false; }
        const commands = sessionId ? harnessStatuses[sessionId]?.parsed?.availableCommands : undefined;
        const agentName = harnessDisplayName(harnesses, session?.harnessId, "This agent");
        if (!session?.openclawSessionKey?.startsWith("direct:acp:")) {
          setNotice(`${agentName} runs through the Gateway here, which doesn't share the agent's commands with Capsule, so /${name} can't run from this menu.`); return false;
        }
        if (!commands?.some((command) => command.name === name)) {
          setNotice(`${agentName} doesn't offer /${name}. Type / to see the commands it does.`); return false;
        }
        if (input.length > 4000 || /[\r\n\0]/.test(input)) { setNotice("Command input must be one line of at most 4,000 characters."); return false; }
        return send(false, `/${name}${input.trim() ? ` ${input.trim()}` : ""}`);
      },
      checkoutBranch,
      inspectorTab,
      setInspectorTab,
      openFile: (path: string, root?: string) => {
        setRequestedFile({ path, root: root ?? session?.workingDirectory ?? project?.workingDirectory, projectId, sessionId });
        setInspectorOpen(true);
        setInspectorTab("files");
      },
      requestedFile,
      clearRequestedFile: () => setRequestedFile(undefined),
      openInspector,
      contentSearch,
      setContentSearch,
      queue,
      followUpsBlocked: followUps.blocked,
      followUpsHeld: followUps.held,
      releaseQueued: (id?: string) => { void changeFollowUps(id ? { type: "release", id } : { type: "release" }); },
      queuedEdit: queuedEdit ? { id: queuedEdit.id } : undefined,
      cancelQueuedEdit,
      saveQueuedEdit,
      removeQueued,
      moveQueued,
      editQueued,
      steerQueued,
      threadFind,
      setThreadFind,
      threadFindQuery,
      findInThread,
      promptJump,
      setPromptJump,
      pendingResume,
      scheduleResume,
      cancelResume,
      retryPrompt,
      gitCommit,
      gitStage,
      gitDiscard,
      gitApplyHunk,
      gitCreateBranch,
      gitPush,
      gitPull,
      gitFetch,
      gitCreatePullRequest,
      gitMergePullRequest,
      gitMergePullRequestStack,
      gitRebasePullRequestStack,
      settings,
      updateSettings,
      turnMode,
      setTurnMode,
      actOnPlan,
      keepPlanning,
      favoriteModels,
      toggleFavoriteModel,
      config,
      configDiagnostics,
      projectSettings,
      setConfigValue,
    }),
    [
      turnMode,
      favoriteModels,
      api,
      commands,
      view,
      stoppingRunIds,
      status,
      subsystems,
      projects,
      sessions,
      shownAgents,
      skills,
      messages,
      historyLoad,
      transcript,
      hasOlderMessages,
      loadingOlder,
      returnToLatest,
      reloadThread,
      runs,
      events,
      eventLoad,
      artifacts,
      approvals,
      shownHarnesses,
      harnesses,
      harnessSessions,
      doctors,
      harnessStatuses,
      loadHarnessStatus,
      projectId,
      sessionId,
      agentId,
      mode,
      draft,
      attachments,
      promptStashes,
      preparingAttachments,
      requestedFile,
      busy,
      sendBlockReason,
      agentCommandsOpen,
      palette,
      paletteQuery,
      newProjectName,
      notice,
      setNotice,
      steerDraft,
      steeringPending,
      steeringVersion,
      project,
      session,
      activeRun,
      pendingApproval,
      pendingApprovals,
      connected,
      steps,
      git,
      gitError,
      files,
      confirm,
      ready,
      startupError,
      sidebarCollapsed,
      inspectorOpen,
      sidebarWidth,
      skillId,
      filePicker,
      contentSearch,
      queue,
      followUps.blocked,
      followUps.held,
      queuedEdit,
      threadFind,
      threadFindQuery,
      promptJump,
      pendingResume,
      navigation,
      inspectorTab,
      projectRuns,
      settings,
      configView,
      projectSettings,
      workspaceMode,
      browserUrl,
      refresh,
      loadSession,
      draftApproval,
      keyBindings,
      keyChordPending,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
