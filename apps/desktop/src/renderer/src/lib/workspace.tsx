import { applyAppearance } from "./appearance";
import { RequestScope } from "./request-scope";
import { HarnessStatusCache, harnessStatusIdentity } from "./harness-status-cache";
import { batchRunFrames, mergeMessagePage, mergeRunEvents, mergeRuns } from "./run-updates";
import { boundTranscript, retainRunReceipts } from "./transcript-window";
import { boundRunEvents, compactRunEvent, runEventBytes, LIVE_EVENT_LIMIT, LIVE_EVENT_BYTES, localTimings, summarizeRun } from "@capsule/shared";
import { useScopedState } from "./scoped-state";
import { SteeringDrafts } from "./steering-drafts";
import { activityFromEvents, type RunActivity } from "./activity";
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
import {
  addFolderToProject,
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
  type HarnessDoctorReport,
  type HarnessLiveStatus,
  type HarnessPermissionProfile,
  type HarnessStatus,
  type MessageAttachment,
  type Project,
  type ProjectAction,
  type Run,
  type RunEvent,
  type RuntimeStatus,
  type Session,
  type Skill,
  type SkillPack,
  type SkillCatalogPage,
  type SubsystemStatus,
  type WorkspaceMode,
} from "@capsule/shared";

import type { SettingsSectionId } from "../features/settings/settings-search";
import { commandForEvent, parseChord, type Keymap } from "./keybindings";
import { formatUserError } from "./errors";
import { contextUsageFromEvents, type ContextUsage } from "./context-window";
import { harnessPreflightReason } from "./harness-preflight";
import {
  promptDraftKey,
  readPromptDraft,
  readPromptStash,
  recoverFailedPrompt,
  stashPrompt,
  writePromptDraft,
  writePromptStash,
  type PromptStashEntry,
  type PromptDraft,
} from "./prompt-stash";

export type View =
  | "chat"
  | "project"
  | "runtimes"
  | "skills"
  | "history"
  | "approvals"
  | "usage"
  | "settings";
export type InspectorTab =
  | "launcher"
  | "files"
  | "preview"
  | "changes"
  | "diff"
  | "run"
  | "agents"
  | "chat"
  | "term"
  | "browser";

export const MODES: AgentMode[] = ["plan", "chat", "agent", "code", "research", "browser", "automation"];
export const PRIMARY_MODES: AgentMode[] = ["plan", "chat", "code"];
export const MORE_MODES: AgentMode[] = ["agent", "research", "browser", "automation"];
/*
 * The detail lines matter more than the labels here. These map onto acpx
 * permission modes, which cannot show a dialog, so "Supervised" refuses a tool
 * rather than asking about it — behaviour nobody would guess from the name.
 */
export const PERMISSION_OPTIONS = [
  {
    id: "strict",
    label: "Supervised",
    detail: "Refuses commands and file writes. It cannot ask, so it declines.",
  },
  {
    id: "default",
    label: "Standard",
    detail: "Reads, writes and runs commands inside the project folder.",
  },
  {
    id: "approve-all",
    label: "Full access",
    detail: "Everything Standard allows, with no approval step at all.",
  },
] as const;

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

export interface ConfirmState {
  title: string;
  detail: string;
  danger?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
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
  runs: Run[];
  events: RunEvent[];
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  harnesses: HarnessStatus[];
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
  promptStashes: PromptStashEntry[];
  busy: boolean;
  sendBlockReason?: string;
  palette: boolean;
  paletteQuery: string;
  newProjectName: string;
  diagnostics: string;
  notice?: string;
  setNotice: (value: string | undefined) => void;
  steerDraft: string;
  project?: Project;
  session?: Session;
  activeRun?: Run;
  pendingApproval?: ApprovalRequest;
  connected: boolean;
  steps: RunActivity[];
  /** How full the harness's context window is, when it has said. */
  contextUsage?: ContextUsage;
  setProjectId: (id: string, nextSessionId?: string) => void;
  setSessionId: (id?: string) => void;
  setAgentId: (id: string) => void;
  setMode: (mode: AgentMode) => void;
  setDraft: (value: string) => void;
  pickAttachments: () => Promise<void>;
  attachClipboardImage: () => Promise<boolean>;
  attachFiles: (paths: string[]) => Promise<boolean>;
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
  createTask: () => Promise<void>;
  send: () => Promise<boolean>;
  createProject: () => Promise<void>;
  git?: GitStatus;
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
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => void;
  archiveSession: (id: string) => Promise<void>;
  openTerminal: () => Promise<void>;
  execInProject: (command: string) => Promise<{ stdout: string; stderr: string; code: number; }>;
  initializeGit: () => Promise<void>;
  saveProjectActions: (actions: ProjectAction[]) => Promise<{ saved: true } | { saved: false; error: string }>;
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: (mode: WorkspaceMode) => Promise<void>;
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
  exportDiagnostics: () => Promise<void>;
  ready: boolean;
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
  openFile: (path: string) => void;
  /** The file the inspector has been asked to show, if any. */
  requestedFile?: string;
  clearRequestedFile: () => void;
  contentSearch: boolean;
  setContentSearch: (open: boolean) => void;
  gitCommit: (message: string) => Promise<boolean>;
  gitStage: (relative: string) => Promise<void>;
  gitDiscard: (relative: string) => void;
  gitCreateBranch: (branch: string) => Promise<void>;
  gitPush: () => Promise<boolean>;
  gitCreatePullRequest: (input?: { title?: string; body?: string; }) => Promise<boolean>;
  gitMergePullRequest: () => Promise<void>;
  skillPacks: SkillPack[];
  installSkill: (skill: Skill) => Promise<Skill>;
  installSkillPack: (packId: string) => Promise<SkillPack>;
  uninstallSkill: (skillId: string) => Promise<void>;
  searchSkillCatalog: (query: string, refresh?: boolean) => Promise<SkillCatalogPage>;
  fetchSkillDetail: (id: string) => Promise<string | undefined>;
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;
  settings?: CapsuleSettings;
  updateSettings: (patch: Partial<CapsuleSettings>) => Promise<CapsuleSettings>;
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

/** Messages fetched per page; older pages load on demand. */
const MESSAGE_PAGE_SIZE = 60;

export function WorkspaceProvider({ children }: { children: ReactNode; }) {
  const api = window.capsule;
  const stoppingRuns = useRef(new Set<string>());
  const [stoppingRunIds, setStoppingRunIds] = useState<string[]>([]);
  const [view, setView] = useState<View>("chat");
  const [settingsTab, setSettingsTab] = useState<SettingsSectionId>("general");
  const [status, setStatus] = useState<RuntimeStatus>();
  const [subsystems, setSubsystems] = useState<SubsystemStatus>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillPacks, setSkillPacks] = useState<SkillPack[]>([]);
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
  const [ready, setReady] = useState(false);
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
  const [mode, setMode] = useState<AgentMode>("chat");
  const [draft, setDraftValue] = useScopedState(draftScope, "");
  const [attachments, setAttachmentValues] = useScopedState<MessageAttachment[]>(draftScope, []);
  const draftRevision = useRef(0);
  const setDraft = useCallback((value: Parameters<typeof setDraftValue>[0]) => {
    draftRevision.current++;
    setDraftValue(value);
  }, [setDraftValue]);
  const setAttachments = useCallback((value: Parameters<typeof setAttachmentValues>[0]) => {
    draftRevision.current++;
    setAttachmentValues(value);
  }, [setAttachmentValues]);
  const [promptStashes, setPromptStashes] = useState<PromptStashEntry[]>(() => {
    try {
      return readPromptStash(localStorage);
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useScopedState(scope, false);
  const submissions = useRef(new Set<string>());
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [diagnostics, setDiagnostics] = useState("");
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
  const steering = useRef(new SteeringDrafts()).current;
  const [steeringVersion, renderSteering] = useState(0);
  const steeringKey = JSON.stringify([projectId, sessionId]);
  const steerDraft = steering.get(steeringKey).text;
  const steeringPending = steering.get(steeringKey).pending;
  const setSteerDraft = (value: string) => {
    if (!steering.edit(steeringKey, value)) {
      setNotice("Steering draft storage is full. Send or clear another thread's draft before adding more text.");
      return;
    }
    renderSteering((version) => version + 1);
  };
  const [git, setGit] = useScopedState<GitStatus | undefined>(scope, undefined);
  const [files, setFiles] = useScopedState<FileEntry[]>(scope, []);
  const [confirm, setConfirm] = useScopedState<ConfirmState | undefined>(scope, undefined);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => storedFlag(SIDEBAR_COLLAPSED_KEY));
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
  const [requestedFile, setRequestedFile] = useState<string>();
  const [projectRuns, setProjectRuns] = useState<Run[]>([]);
  const [settings, setSettings] = useState<CapsuleSettings>();
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

  const keymap = useMemo<Keymap>(() => {
    const stored = settings?.keybindings ?? {};
    const map: Keymap = {};
    for (const [id, value] of Object.entries(stored)) {
      const chord = parseChord(value);
      // A stored chord that no longer parses falls back to the default rather
      // than leaving the command unreachable.
      if (chord) map[id] = chord;
    }
    return map;
  }, [settings?.keybindings]);


  const project = projects.find((item) => item.id === projectId);
  const session = sessions.find((item) => item.id === sessionId && item.projectId === projectId);
  const currentDraftKey = promptDraftKey(projectId, sessionId);
  const latestDraft = useRef({ key: currentDraftKey, value: { prompt: draft, attachments, skillId } });
  latestDraft.current = { key: currentDraftKey, value: { prompt: draft, attachments, skillId } };
  const promotedDrafts = useRef(new Map<string, PromptDraft>());
  const latestStashes = useRef(promptStashes);
  latestStashes.current = promptStashes;
  const activeRun = runs.find(
    (run) => run.sessionId === sessionId && ["running", "approval_required", "waiting"].includes(run.status),
  );
  const pendingApproval = approvals.find(
    (item) => item.status === "pending" && runs.some((run) => run.id === item.runId),
  );
  const loadGeneration = useRef(0);
  const liveRunState = useMemo(() => ({ runs: new Map<string, Run>(), events: new Map<string, RunEvent>(), eventBytes: 0, latest: undefined as Run | undefined, loadedOlder: false }), [scope]);
  const connected = status?.state === "connected" && status.kind === "openclaw";
  const selectedHarness = harnesses.find((item) => item.id === agentId);
  const harnessLive = Boolean(
    session?.harnessId === selectedHarness?.id && session?.openclawSessionKey && ["spawning", "running", "waiting"].includes(session.harnessState ?? ""),
  );
  const sendBlockReason = harnessPreflightReason({
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
    try {
      const [
        nextProjects,
        nextAgents,
        nextSkills,
        nextSkillPacks,
        nextStatus,
        nextSub,
        nextApprovals,
        nextHarnesses,
        nextSettings,
      ] = await Promise.all([
          api.listProjects(),
          api.listAgents(),
          api.listSkills(projectId, sessionId),
          api.listSkillPacks(),
          api.getStatus(),
          api.getSubsystemStatus(),
          api.listApprovals("pending"),
          api.listHarnesses(),
          api.getSettings(),
        ]);
      if (!current()) return;
      setProjects(nextProjects);
      setAgents(nextAgents);
      setSkills(nextSkills);
      setSkillPacks(nextSkillPacks);
      setStatus(nextStatus);
      setSubsystems(nextSub);
      setApprovals(nextApprovals);
      setHarnesses(nextHarnesses);
      setSettings(nextSettings as CapsuleSettings);
      applyAppearance(nextSettings as CapsuleSettings);
      if (!settingsDefaultsApplied.current && nextSettings) {
        const loaded = nextSettings as CapsuleSettings;
        settingsDefaultsApplied.current = true;
        setMode(loaded.defaultMode);
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
      const selectedProject = nextProjects.some((item: Project) => item.id === projectId) ? projectId : nextProjects[0]?.id;
      if (selectedProject && selectedProject !== projectId) {
        applyProjectDefaults(nextProjects.find((item: Project) => item.id === selectedProject), nextHarnesses);
        setProjectId(selectedProject);
      }
      const runsCurrent = requests.capture("project-runs");
      const [nextSessions, nextHarnessSessions, nextRuns] = await Promise.all([
        api.listSessions(),
        selectedProject ? api.listHarnessSessions(selectedProject) : Promise.resolve([]),
        api.listLatestRuns(),
      ]);
      if (!current()) return;
      setSessions(nextSessions);
      setHarnessSessions(nextHarnessSessions);
      if (runsCurrent()) setProjectRuns(mergeRuns(nextRuns, [...liveRunState.runs.values()]));
      if (!sessionId || !nextSessions.some((item: Session) => item.id === sessionId)) {
        const savedSessionId = (() => {
          try {
            return localStorage.getItem(LAST_SESSION_ID_KEY) || undefined;
          } catch {
            return undefined;
          }
        })();
        const validSaved = savedSessionId && nextSessions.find(
          (item: Session) => item.id === savedSessionId && item.projectId === selectedProject && item.state === "active",
        );
        const first = validSaved ?? nextSessions.find(
          (item: Session) => item.projectId === selectedProject && item.state === "active",
        );
        if (first) setSessionId(first.id);
      }
    } catch (error) {
      console.error("Failed to load Capsule state", error);
      setNotice(formatUserError(error));
    } finally {
      setReady(true);
    }
  }, [agentId, api, scope, projectId, sessionId, liveRunState]);

  const loadGit = useCallback(async () => {
    if (!projectId || !requests.isCurrent(scope)) return;
    const current = requests.capture("git");
    try {
      const result = await api.gitStatus(projectId, sessionId);
      if (current()) setGit(result);
    } catch (error) {
      if (current()) { setGit(undefined); setNotice(formatUserError(error)); }
    }
  }, [api, scope, projectId, sessionId]);

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
        void refresh();
        if (sessionId) void loadSession(sessionId).catch(() => { /* History owns its loading and retry UI. */ });
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
        if (command === "runs") setView("history");
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
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        Boolean(event.target.closest("input, textarea, select, [contenteditable]"));

      const command = commandForEvent(event, keymap);
      if (!command) return;
      // Typing a letter into a field must stay typing, even when the same
      // letter is a shortcut somewhere else.
      if (typing && !event.metaKey && !event.ctrlKey) return;

      event.preventDefault();
      switch (command.id) {
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
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      batch.dispose();
      off.forEach((fn) => fn());
      window.removeEventListener("keydown", onKey, true);
    };
  }, [api, loadGit, loadSession, projectId, refresh, sessionId, scope, liveRunState, setBrowserUrl]);

  useEffect(() => {
    if (sessionId) void loadSession(sessionId).catch(() => { /* History owns its loading and retry UI. */ });
  }, [sessionId, loadSession]);

  useEffect(() => {
    if (session?.workspaceMode) setWorkspaceModeState(session.workspaceMode);
  }, [session?.id, session?.workspaceMode]);

  useEffect(() => {
    skipDraftSave.current = true;
    try {
      const saved = promotedDrafts.current.get(currentDraftKey) ?? readPromptDraft(localStorage, currentDraftKey);
      promotedDrafts.current.delete(currentDraftKey);
      setDraft(saved.prompt);
      setAttachments(saved.attachments);
      setSkillId(saved.skillId);
    } catch {
      setDraft("");
      setAttachments([]);
      setSkillId(undefined);
    }
  }, [currentDraftKey]);

  useEffect(() => {
    if (skipDraftSave.current) {
      skipDraftSave.current = false;
      return;
    }
    try {
      writePromptDraft(localStorage, currentDraftKey, { prompt: draft, attachments, skillId });
    } catch {
      // Draft persistence is a convenience; storage policy must not break chat.
    }
  }, [attachments, currentDraftKey, draft, skillId]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore quota */
    }
  }, [sidebarCollapsed]);

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
    setMode(nextProject.defaultMode);
  }

  useEffect(() => {
    if (!projectId) {
      setGit(undefined);
      setFiles([]);
      return;
    }
    void loadGit();
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
  }, [api, scope, loadGit, projectId, project?.workingDirectory, sessionId, session?.workingDirectory]);

  async function createTask() {
    const targetProject = projectId ?? projects[0]?.id;
    if (!targetProject) return;
    const created = await api.createSession({
      projectId: targetProject,
      agentId,
      mode,
      permissionProfile: settings?.defaultPermission,
      workspaceMode: git?.isRepo ? (settings?.defaultWorkspaceMode ?? "local") : "local",
      title: "New conversation",
    });
    if (!requests.isCurrent(scope)) return;
    setSessionId(created.id);
    setView("chat");
    await refresh();
  }

  async function send(continueToNew = false) {
    const submissionKey = currentDraftKey;
    const submittedRevision = draftRevision.current;
    const content = draft.trim() || (skillId ? `Use the ${skills.find((item) => item.id === skillId)?.name ?? "selected"} skill.` : "");
    const filesToSend = attachments;
    if ((!content && filesToSend.length === 0) || busy || submissions.current.has(submissionKey)) return false;
    if (activeRun) {
      setNotice("This thread already has an active turn. Stop it or wait before sending a follow-up.");
      return false;
    }
    if (sendBlockReason) {
      setNotice(sendBlockReason);
      return false;
    }
    submissions.current.add(submissionKey);
    setBusy(true);
    setNotice(undefined);
    let preparedThread = false;
    const recoverSubmission = (error: unknown, targetProjectId = projectId) => {
      const recovery = recoverFailedPrompt(localStorage, latestStashes.current, {
        prompt: content, attachments: filesToSend, skillId, projectId: targetProjectId,
      });
      latestStashes.current = recovery.entries;
      setPromptStashes(recovery.entries);
      const location = recovery.persisted ? "saved in Stash" : "kept temporarily in Stash until the app closes; local storage could not save it";
      setNotice(`The message was not sent and was ${location}. Your new draft is unchanged. ${formatUserError(error)}`);
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
          permissionProfile: settings?.defaultPermission,
          workspaceMode: git?.isRepo ? workspaceMode : "local",
          title: "New conversation",
        });
        currentSessionId = created.id;
      }
      if (!currentSessionId) return false;
      if (!draftScopes.isCurrent(draftScope)) return false;
      preparedThread = true;
      const optimisticId = `local-${Date.now()}`;
      setMessages((current) => [
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
      const unchanged = draftRevision.current === submittedRevision;
      if (unchanged) {
        setDraft("");
        setAttachments([]);
        setSkillId(undefined);
      }
      let accepted = false;
      const clearedRevision = unchanged ? draftRevision.current : undefined;
      try {
        await api.sendMessage({
          sessionId: currentSessionId,
          content,
          agentId,
          mode,
          skillId,
          attachments: filesToSend,
        });
        accepted = true;
        if (draftScopes.isCurrent(draftScope) && draftRevision.current === clearedRevision) setSkillId(undefined);
        let selectionChanged = false;
        if (draftScopes.isCurrent(draftScope)) {
          const next = continueToNew ? await api.createSession({
            projectId: currentProjectId,
            agentId,
            mode,
            permissionProfile: settings?.defaultPermission,
            workspaceMode: git?.isRepo ? (settings?.defaultWorkspaceMode ?? "local") : "local",
            title: "New conversation",
          }) : undefined;
          if (draftScopes.isCurrent(draftScope)) {
            selectionChanged = Boolean(next) || projectId !== currentProjectId || sessionId !== currentSessionId;
            if (selectionChanged) {
              // Promote any follow-up typed during creation or sending with its
              // new thread. Keep an in-memory handoff if storage is unavailable.
              const targetKey = promptDraftKey(currentProjectId, next?.id ?? currentSessionId);
              const followup = latestDraft.current.key === submissionKey
                && draftRevision.current !== clearedRevision ? latestDraft.current.value : { prompt: "", attachments: [] };
              promotedDrafts.current.set(targetKey, followup);
              writePromptDraft(localStorage, targetKey, followup);
              writePromptDraft(localStorage, submissionKey, { prompt: "", attachments: [] });
            }
            setProjectId(currentProjectId);
            setSessionId(next?.id ?? currentSessionId);
            if (!next && currentSessionId === sessionId) await loadSession(currentSessionId);
          }
        }
        // The new selection's effect owns its refresh. The old selection's
        // refresh can otherwise auto-select the first thread over the new one.
        if (!selectionChanged) await refresh();
        return true;
      } catch (error) {
        if (!accepted) {
          if (draftScopes.isCurrent(draftScope) && draftRevision.current === clearedRevision) {
            setDraft(content);
            setAttachments(filesToSend);
            setSkillId(skillId);
          } else {
            // Keep the new draft and preserve the failed submission separately.
            setMessages((current) => current.filter((item) => item.id !== optimisticId));
            recoverSubmission(error, currentProjectId);
            return false;
          }
          setMessages((current) => current.filter((item) => item.id !== optimisticId));
        } else {
          if (draftScopes.isCurrent(draftScope)) {
            setProjectId(currentProjectId);
            setSessionId(currentSessionId);
          }
          setNotice(`Your message was sent, but the view could not refresh: ${formatUserError(error)}`);
          return true;
        }
        throw error;
      }
    } catch (error) {
      if (!preparedThread && draftRevision.current !== submittedRevision) recoverSubmission(error);
      else setNotice(formatUserError(error));
      return false;
    } finally {
      submissions.current.delete(submissionKey);
      setBusy(false);
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
    return directory.split("/").filter(Boolean).pop() || "Project";
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
        const parent = first.split("/").slice(0, -1).join("/") || "/";
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
      const prefix = `${root.replace(/\/$/, "")}/`;
      for (const absolute of paths) {
        mentionFile(absolute.startsWith(prefix) ? absolute.slice(prefix.length) : (absolute.split("/").pop() ?? absolute));
      }
      setView("chat");
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function attachFiles(paths: string[]) {
    try {
      if (!paths?.length) return false;
      const validated: MessageAttachment[] = await api.validateAttachments(
        paths.map((filePath) => ({
          name: filePath.split("/").filter(Boolean).pop() ?? filePath,
          path: filePath,
        })),
      );
      if (!draftScopes.isCurrent(draftScope)) return false;
      const existing = new Set(attachments.map((item) => item.path));
      if (new Set([...existing, ...validated.map((item) => item.path)]).size > 8) throw new Error("You can attach up to 8 files. Remove one first.");
      setAttachments((current) => {
        const byPath = new Map(current.map((item) => [item.path, item]));
        for (const item of validated) byPath.set(item.path, item);
        return [...byPath.values()].slice(0, 8);
      });
      setNotice(undefined);
      return true;
    } catch (error) {
      setNotice(formatUserError(error));
      return false;
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
  async function attachClipboardImage(): Promise<boolean> {
    try {
      const saved = (await api.saveClipboardImage()) as string | undefined;
      if (!saved) return false;
      return await attachFiles([saved]);
    } catch (error) {
      setNotice(formatUserError(error));
      return false;
    }
  }

  async function pickAttachments() {
    const paths = await api.pickFiles() as string[] | undefined;
    if (paths?.length) await attachFiles(paths);
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
      setNotice("Prompt stashed. Press ⌘S with an empty composer to open the stash.");
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

  async function renameSession(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    await api.renameSession(id, trimmed);
    await refresh();
  }

  function deleteSession(id: string) {
    const target = sessions.find((item) => item.id === id);
    setConfirm({
      title: `Delete “${target?.title ?? "conversation"}”?`,
      detail: "Messages and runs in this conversation are removed.",
      danger: true,
      confirmLabel: "Delete",
      onConfirm: () => {
        void (async () => {
          await api.deleteSession(id);
          if (sessionId === id) setSessionId(undefined);
          setConfirm(undefined);
          await refresh();
        })();
      },
    });
  }

  async function archiveSession(id: string) {
    await api.archiveSession(id);
    if (sessionId === id) setSessionId(undefined);
    await refresh();
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

  async function execInProject(command: string) {
    if (!projectId) throw new Error("No project selected");
    return await api.execInProject(projectId, command, sessionId) as {
      stdout: string;
      stderr: string;
      code: number;
    };
  }

  async function initializeGit() {
    if (!projectId) return;
    if (await performGit(() => api.gitInit(projectId))) {
      setNotice("Git initialized. Create the first commit before using worktree conversations.");
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
            : settings?.defaultPermission,
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
      if (!report.ready) {
        setNotice(
          report.gatewayOutput ||
          report.checks.find((item: { ok: boolean; detail: string; }) => !item.ok)?.detail,
        );
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

  async function exportDiagnostics() {
    const snapshot = await api.getDiagnostics();
    setDiagnostics(JSON.stringify({ ...snapshot, rendererPerformance: localTimings.snapshot() }, null, 2));
  }

  async function stopRun() {
    if (!activeRun || stoppingRuns.current.has(activeRun.id)) return;
    const runId = activeRun.id;
    stoppingRuns.current.add(runId);
    setStoppingRunIds([...stoppingRuns.current]);
    try {
      await api.stopRun(runId);
      await refresh();
    } catch (error) { setNotice(formatUserError(error)); }
    finally { stoppingRuns.current.delete(runId); setStoppingRunIds([...stoppingRuns.current]); }
  }

  async function pinSession(id: string, pinned: boolean) {
    await api.pinSession(id, pinned);
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

  async function updateSettings(patch: Partial<CapsuleSettings>) {
    const next = await api.updateSettings(patch) as CapsuleSettings;
    setSettings(next);
    applyAppearance(next);
    if (patch.defaultMode) setMode(patch.defaultMode);
    if (patch.defaultAgentId) setAgentId(patch.defaultAgentId);
    if (patch.defaultWorkspaceMode) setWorkspaceModeState(patch.defaultWorkspaceMode);
    return next;
  }

  async function performGit(operation: () => Promise<GitStatus>): Promise<boolean> {
    if (!requests.isCurrent(scope)) return false;
    const current = requests.capture("git");
    try {
      const next = await operation();
      if (!current()) return requests.isCurrent(scope);
      setGit(next);
      setNotice(undefined);
      return true;
    } catch (error) {
      if (requests.isCurrent(scope)) setNotice(formatUserError(error));
      return false;
    }
  }

  async function gitCommit(message: string) {
    return projectId ? performGit(() => api.gitCommit(projectId, message, sessionId)) : false;
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

  async function gitCreateBranch(branch: string) {
    if (projectId) await performGit(() => api.gitCreateBranch(projectId, branch, sessionId));
  }

  async function gitPush() {
    return projectId ? performGit(() => api.gitPush(projectId, sessionId)) : false;
  }

  async function gitCreatePullRequest(input?: { title?: string; body?: string; }) {
    return projectId ? performGit(() => api.gitCreatePullRequest(projectId, { ...input, sessionId })) : false;
  }

  async function gitMergePullRequest() {
    if (projectId) await performGit(() => api.gitMergePullRequest(projectId, sessionId, git?.pullRequest?.url));
  }

  const installSkill = useCallback(
    async (skill: Skill) => {
      const result = await api.installSkill(skill) as Skill;
      await refresh();
      return result;
    },
    [api, refresh],
  );

  const installSkillPack = useCallback(
    async (packId: string) => {
      const result = await api.installSkillPack(packId) as SkillPack;
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
    reasoning: settings?.reasoningSummary,
  }), [events, activeRun?.status, settings?.reasoningSummary]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      api,
      view,
      setView,
      settingsTab,
      setSettingsTab,
      resetSettingsSection,
      status,
      subsystems,
      projects,
      sessions,
      agents,
      skills,
      skillPacks,
      installSkill,
      installSkillPack,
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
      loadingOlder,
      loadOlderMessages,
      runs,
      events,
      eventLoad,
      artifacts,
      approvals,
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
      busy,
      sendBlockReason,
      palette,
      paletteQuery,
      newProjectName,
      diagnostics,
      notice,
      setNotice,
      steerDraft,
      project,
      session,
      activeRun,
      pendingApproval,
      connected,
      steps,
      contextUsage,
      git,
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
      setAgentId,
      setMode,
      setDraft,
      pickAttachments,
      attachClipboardImage,
      attachFiles,
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
      send,
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
      archiveSession,
      openTerminal,
      execInProject,
      initializeGit,
      saveProjectActions,
      workspaceMode,
      setWorkspaceMode,
      browserUrl,
      setBrowserUrl,
      projectRuns,
      openPath,
      mentionFile,
      spawnHarness,
      dedicateHarness,
      undedicateHarness,
      doctorHarness,
      cancelHarness,
      steerHarness,
      closeHarness,
      refreshHarnessStatus,
      setHarnessOption,
      ready,
      exportDiagnostics,
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
      stoppingRunIds,
      skillId,
      setSkillId,
      filePicker,
      setFilePicker,
      pinSession,
      reorderPinnedSessions,
      regenerateTitle,
      setPermissionProfile,
      sendAndContinue,
      checkoutBranch,
      inspectorTab,
      setInspectorTab,
      openFile: (path: string) => {
        setRequestedFile(path);
        setInspectorOpen(true);
        setInspectorTab("files");
      },
      requestedFile,
      clearRequestedFile: () => setRequestedFile(undefined),
      openInspector,
      contentSearch,
      setContentSearch,
      gitCommit,
      gitStage,
      gitDiscard,
      gitCreateBranch,
      gitPush,
      gitCreatePullRequest,
      gitMergePullRequest,
      settings,
      updateSettings,
    }),
    [
      api,
      view,
      stoppingRunIds,
      status,
      subsystems,
      projects,
      sessions,
      agents,
      skills,
      messages,
      historyLoad,
      transcript,
      hasOlderMessages,
      loadingOlder,
      returnToLatest,
      runs,
      events,
      eventLoad,
      artifacts,
      approvals,
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
      busy,
      sendBlockReason,
      palette,
      paletteQuery,
      newProjectName,
      diagnostics,
      notice,
      setNotice,
      steerDraft,
      steeringPending,
      steeringVersion,
      project,
      session,
      activeRun,
      pendingApproval,
      connected,
      steps,
      git,
      files,
      confirm,
      ready,
      sidebarCollapsed,
      inspectorOpen,
      sidebarWidth,
      skillId,
      filePicker,
      contentSearch,
      inspectorTab,
      projectRuns,
      settings,
      workspaceMode,
      browserUrl,
      refresh,
      loadSession,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
