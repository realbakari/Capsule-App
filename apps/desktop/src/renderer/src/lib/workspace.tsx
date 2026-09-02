import { applyAppearance } from "./appearance";
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
import { latestContextUsage, type ContextUsage } from "./context-window";
import { harnessPreflightReason } from "./harness-preflight";
import {
  promptDraftKey,
  readPromptDraft,
  readPromptStash,
  stashPrompt,
  writePromptDraft,
  writePromptStash,
  type PromptStashEntry,
} from "./prompt-stash";

export type View =
  | "chat"
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
  hasOlderMessages: boolean;
  loadingOlder: boolean;
  loadOlderMessages: () => Promise<void>;
  runs: Run[];
  events: RunEvent[];
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  harnesses: HarnessStatus[];
  harnessSessions: Session[];
  doctors: Partial<Record<string, HarnessDoctorReport>>;
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
  statusText?: string;
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
  attachFiles: (paths: string[]) => Promise<void>;
  removeAttachment: (path: string) => void;
  stashCurrentPrompt: () => void;
  restorePromptStash: (id: string) => void;
  deletePromptStash: (id: string) => void;
  setPalette: (open: boolean) => void;
  setPaletteQuery: (value: string) => void;
  setNewProjectName: (value: string) => void;
  setSteerDraft: (value: string) => void;
  refresh: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  createTask: () => Promise<void>;
  send: () => Promise<void>;
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
  execInProject: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>;
  initializeGit: () => Promise<void>;
  saveProjectActions: (actions: ProjectAction[]) => Promise<void>;
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
    options?: { mode?: "persistent" | "oneshot" },
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
  ) => Promise<void>;
  exportDiagnostics: () => Promise<void>;
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
  contentSearch: boolean;
  setContentSearch: (open: boolean) => void;
  gitCommit: (message: string) => Promise<void>;
  gitStage: (relative: string) => Promise<void>;
  gitDiscard: (relative: string) => void;
  gitCreateBranch: (branch: string) => Promise<void>;
  gitPush: () => Promise<void>;
  gitCreatePullRequest: (input?: { title?: string; body?: string }) => Promise<void>;
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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const api = window.capsule;
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [projectId, setProjectId] = useState<string>();
  const [sessionId, setSessionId] = useState<string>();
  const [agentId, setAgentId] = useState<string>("general");
  const [mode, setMode] = useState<AgentMode>("chat");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [promptStashes, setPromptStashes] = useState<PromptStashEntry[]>(() => {
    try {
      return readPromptStash(localStorage);
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [diagnostics, setDiagnostics] = useState("");
  const [harnesses, setHarnesses] = useState<HarnessStatus[]>([]);
  const [harnessSessions, setHarnessSessions] = useState<Session[]>([]);
  const [doctors, setDoctors] = useState<Partial<Record<string, HarnessDoctorReport>>>({});
  const [notice, setNotice] = useState<string>();
  const [steerDraft, setSteerDraft] = useState("");
  const [statusText, setStatusText] = useState<string>();
  const [git, setGit] = useState<GitStatus>();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => storedFlag(SIDEBAR_COLLAPSED_KEY));
  const [inspectorOpen, setInspectorOpen] = useState(() => storedFlag(INSPECTOR_OPEN_KEY));
  const [terminalOpen, setTerminalOpen] = useState(() => storedFlag(TERMINAL_OPEN_KEY));
  const [sidebarWidth, setSidebarWidthState] = useState(() =>
    Math.min(352, Math.max(220, storedNumber(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH))),
  );
  const [skillId, setSkillId] = useState<string>();
  const [filePicker, setFilePicker] = useState(false);
  const [contentSearch, setContentSearch] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("launcher");
  const [projectRuns, setProjectRuns] = useState<Run[]>([]);
  const [settings, setSettings] = useState<CapsuleSettings>();
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>("local");
  const [browserUrl, setBrowserUrl] = useState("http://localhost:3000");
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
  const session = sessions.find((item) => item.id === sessionId);
  const currentDraftKey = promptDraftKey(projectId, sessionId);
  const activeRun = runs.find(
    (run) => run.sessionId === sessionId && ["running", "approval_required", "waiting"].includes(run.status),
  );
  const pendingApproval = approvals.find(
    (item) => item.status === "pending" && runs.some((run) => run.id === item.runId),
  );
  const loadGeneration = useRef(0);
  const connected = status?.state === "connected" && status.kind === "openclaw";
  const selectedHarness = harnesses.find((item) => item.id === agentId);
  const harnessLive = Boolean(
    session?.harnessId && session.harnessState && session.harnessState !== "closed",
  );
  const sendBlockReason = harnessPreflightReason({
    harness: mode === "code" ? selectedHarness : undefined,
    connected,
    folder: session?.workingDirectory ?? project?.workingDirectory,
    live: harnessLive,
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
      const generation = ++loadGeneration.current;
      // Only the most recent page. Loading an entire conversation on every
      // streamed chunk made a long thread quadratic to render.
      const [page, nextRuns] = await Promise.all([
        api.listMessagePage(id, { limit: MESSAGE_PAGE_SIZE }),
        api.listRuns(id),
      ]);
      const nextMessages = page.messages;
      if (generation !== loadGeneration.current) return;
      setMessages((current) => {
        const pending = current.filter(
          (item) =>
            item.id.startsWith("local-") &&
            !nextMessages.some((message: ChatMessage) => message.role === item.role && message.content === item.content),
        );
        return [...nextMessages, ...pending];
      });
      setHasOlderMessages(page.hasMore);
      setRuns(nextRuns);
      setProjectRuns((current) => {
        const others = current.filter((item) => item.sessionId !== id);
        return [...nextRuns, ...others];
      });
      const latest = nextRuns[0];
      if (latest) {
        const [nextEvents, nextArtifacts] = await Promise.all([
          api.listRunEvents(latest.id),
          api.listArtifacts(latest.id),
        ]);
        if (generation !== loadGeneration.current) return;
        setEvents(nextEvents);
        setArtifacts(nextArtifacts);
      } else {
        setEvents([]);
        setArtifacts([]);
      }
    },
    [api],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!sessionId || loadingOlder) return;
    const oldest = messages.find((item) => !item.id.startsWith("local-"));
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const page = await api.listMessagePage(sessionId, {
        limit: MESSAGE_PAGE_SIZE,
        before: { createdAt: oldest.createdAt, id: oldest.id },
      });
      setMessages((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...page.messages.filter((item) => !known.has(item.id)), ...current];
      });
      setHasOlderMessages(page.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }, [api, sessionId, messages, loadingOlder]);

  const refresh = useCallback(async () => {
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
          api.listSkills(),
          api.listSkillPacks(),
          api.getStatus(),
          api.getSubsystemStatus(),
          api.listApprovals("pending"),
          api.listHarnesses(),
          api.getSettings(),
        ]);
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
      const selectedProject = projectId ?? nextProjects[0]?.id;
      if (selectedProject && selectedProject !== projectId) {
        applyProjectDefaults(nextProjects.find((item: Project) => item.id === selectedProject), nextHarnesses);
        setProjectId(selectedProject);
      }
      const [nextSessions, nextHarnessSessions, nextRuns] = await Promise.all([
        api.listSessions(),
        selectedProject ? api.listHarnessSessions(selectedProject) : Promise.resolve([]),
        api.listRuns(),
      ]);
      setSessions(nextSessions);
      setHarnessSessions(nextHarnessSessions);
      setProjectRuns(nextRuns);
      if (!sessionId) {
        const first = nextSessions.find(
          (item: Session) => item.projectId === selectedProject && item.state === "active",
        );
        if (first) setSessionId(first.id);
      }
    } catch (error) {
      console.error("Failed to load Capsule state", error);
      setNotice(formatUserError(error));
    }
  }, [agentId, api, projectId, sessionId]);

  useEffect(() => {
    void refresh();
    const off = [
      api.on("connection", () => void refresh()),
      api.on("message", (incoming) => {
        const message = incoming as ChatMessage;
        if (!sessionId || message?.sessionId !== sessionId) return;
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
      api.on("run", () => {
        if (sessionId) void loadSession(sessionId);
        void refresh();
      }),
      api.on("approval", () => void refresh()),
      api.on("state", (payload) => {
        const command = (payload as { command?: string }).command;
        if (command === "palette") setPalette(true);
        if (command === "new-task") void createTask();
        if (command === "skills") setView("skills");
        if (command === "about") setAboutOpen(true);
        if (command === "approvals") setView("approvals");
        if (command === "runs") setView("history");
        if (command === "harness") setView("runtimes");
        if (command === "new-project") void createProjectFromFolder();
        if (command === "open-folder") void pickProjectDirectory();
        if (command === "open-files") void pickFilesToMention();
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
          void api.gitStatus(projectId, sessionId).then(setGit).catch(() => undefined);
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
      off.forEach((fn) => fn());
      window.removeEventListener("keydown", onKey, true);
    };
  }, [api, loadSession, projectId, refresh, sessionId]);

  useEffect(() => {
    if (sessionId) void loadSession(sessionId);
  }, [sessionId, loadSession]);

  useEffect(() => {
    if (session?.workspaceMode) setWorkspaceModeState(session.workspaceMode);
  }, [session?.id, session?.workspaceMode]);

  useEffect(() => {
    skipDraftSave.current = true;
    try {
      const saved = readPromptDraft(localStorage, currentDraftKey);
      setDraft(saved.prompt);
      setAttachments(saved.attachments);
    } catch {
      setDraft("");
      setAttachments([]);
    }
  }, [currentDraftKey]);

  useEffect(() => {
    if (skipDraftSave.current) {
      skipDraftSave.current = false;
      return;
    }
    try {
      writePromptDraft(localStorage, currentDraftKey, { prompt: draft, attachments });
    } catch {
      // Draft persistence is a convenience; storage policy must not break chat.
    }
  }, [attachments, currentDraftKey, draft]);

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
      /* ignore quota */
    }
  }, [sidebarWidth]);

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
    void api.listRuns().then(setProjectRuns).catch(() => undefined);
    void api.gitStatus(projectId, sessionId).then(setGit).catch(() => setGit(undefined));
    void api
      .listFiles(projectId)
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
  }, [api, projectId, project?.workingDirectory, sessionId, session?.workingDirectory]);

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
    setSessionId(created.id);
    setView("chat");
    await refresh();
  }

  async function send() {
    const content = draft.trim();
    const filesToSend = attachments;
    if ((!content && filesToSend.length === 0) || busy) return;
    if (sendBlockReason) {
      setNotice(sendBlockReason);
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      let currentSessionId = sessionId;
      let currentProjectId = projectId ?? projects[0]?.id;
      if (!currentProjectId) {
        const createdProject = await api.createProject({ name: "Inbox" });
        currentProjectId = createdProject.id;
        setProjectId(createdProject.id);
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
        setSessionId(created.id);
      }
      if (!currentSessionId) return;
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
      setDraft("");
      setAttachments([]);
      try {
        await api.sendMessage({
          sessionId: currentSessionId,
          content,
          agentId,
          mode,
          skillId,
          attachments: filesToSend,
        });
        setSkillId(undefined);
        await loadSession(currentSessionId);
        await refresh();
      } catch (error) {
        setDraft(content);
        setAttachments(filesToSend);
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
        throw error;
      }
    } catch (error) {
      setNotice(formatUserError(error));
    } finally {
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
      const paths = (await api.pickFiles()) as string[] | undefined;
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
      if (!paths?.length) return;
      const validated = await api.validateAttachments(
        paths.map((filePath) => ({
          name: filePath.split("/").filter(Boolean).pop() ?? filePath,
          path: filePath,
        })),
      );
      setAttachments((current) => {
        const byPath = new Map(current.map((item) => [item.path, item]));
        for (const item of validated) byPath.set(item.path, item);
        return [...byPath.values()].slice(0, 8);
      });
      setNotice(undefined);
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function pickAttachments() {
    const paths = (await api.pickFiles()) as string[] | undefined;
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
        projectId,
      });
      if (next === promptStashes) {
        if (draft.trim() || attachments.length > 0) setNotice("Could not save the prompt stash.");
        return;
      }
      setPromptStashes(next);
      setDraft("");
      setAttachments([]);
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
      const created = (await api.cloneRepository(input)) as Project;
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
    patch: { workingDirectory?: string; extraFolders: string[] },
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
    return (await api.execInProject(projectId, command, sessionId)) as {
      stdout: string;
      stderr: string;
      code: number;
    };
  }

  async function initializeGit() {
    if (!projectId) return;
    try {
      const next = await api.gitInit(projectId);
      setGit(next);
      setNotice("Git initialized. Create the first commit before using worktree conversations.");
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function saveProjectActions(actions: ProjectAction[]) {
    if (!projectId) return;
    try {
      await api.updateProject(projectId, { actions });
      setNotice(undefined);
      await refresh();
    } catch (error) {
      setNotice(formatUserError(error));
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
    options?: { mode?: "persistent" | "oneshot" },
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
            report.checks.find((item: { ok: boolean; detail: string }) => !item.ok)?.detail,
        );
      }
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function cancelHarness(id?: string) {
    const target = id ?? sessionId;
    if (!target) return;
    await api.cancelHarness(target);
    await refresh();
    await loadSession(target);
  }

  async function steerHarness() {
    if (!sessionId || !steerDraft.trim()) return;
    await api.steerHarness(sessionId, steerDraft.trim());
    setSteerDraft("");
    await refresh();
    await loadSession(sessionId);
  }

  async function closeHarness(id?: string) {
    const target = id ?? sessionId;
    if (!target) return;
    await api.closeHarness(target);
    await refresh();
  }

  async function refreshHarnessStatus(id?: string) {
    const target = id ?? sessionId;
    if (!target) return;
    const live = await api.harnessStatus(target);
    setStatusText(live.statusText);
    await refresh();
  }

  async function setHarnessOption(
    key: "model" | "permissions" | "cwd" | "mode" | "timeout",
    value: string,
  ) {
    if (!sessionId) return;
    await api.setHarnessOption({ sessionId, key, value });
    await refresh();
  }

  async function exportDiagnostics() {
    const snapshot = await api.getDiagnostics();
    setDiagnostics(JSON.stringify(snapshot, null, 2));
  }

  async function stopRun() {
    if (!activeRun) return;
    await api.stopRun(activeRun.id);
    await refresh();
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
    await api.setPermissionProfile(sessionId, profile);
    await refresh();
  }

  async function sendAndContinue() {
    await send();
    await createTask();
  }

  async function checkoutBranch(branch: string) {
    if (!projectId) return;
    try {
      const next = await api.checkoutBranch(projectId, branch, sessionId);
      setGit(next);
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  function openInspector(tab?: InspectorTab) {
    if (tab) setInspectorTab(tab);
    setInspectorOpen(true);
    setView("chat");
  }

  async function updateSettings(patch: Partial<CapsuleSettings>) {
    const next = (await api.updateSettings(patch)) as CapsuleSettings;
    setSettings(next);
    applyAppearance(next);
    if (patch.defaultMode) setMode(patch.defaultMode);
    if (patch.defaultAgentId) setAgentId(patch.defaultAgentId);
    if (patch.defaultWorkspaceMode) setWorkspaceModeState(patch.defaultWorkspaceMode);
    return next;
  }

  async function gitCommit(message: string) {
    if (!projectId) return;
    try {
      setGit(await api.gitCommit(projectId, message, sessionId));
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function gitStage(relative: string) {
    if (!projectId) return;
    try {
      setGit(await api.gitStage(projectId, relative, sessionId));
    } catch (error) {
      setNotice(formatUserError(error));
    }
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
          setGit(await api.gitDiscard(projectId, relative, sessionId));
          setConfirm(undefined);
        })();
      },
    });
  }

  async function gitCreateBranch(branch: string) {
    if (!projectId) return;
    try {
      setGit(await api.gitCreateBranch(projectId, branch, sessionId));
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function gitPush() {
    if (!projectId) return;
    try {
      setGit(await api.gitPush(projectId, sessionId));
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function gitCreatePullRequest(input?: { title?: string; body?: string }) {
    if (!projectId) return;
    try {
      setGit(
        await api.gitCreatePullRequest(projectId, {
          ...input,
          sessionId,
        }),
      );
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  async function gitMergePullRequest() {
    if (!projectId) return;
    try {
      setGit(await api.gitMergePullRequest(projectId, sessionId));
    } catch (error) {
      setNotice(formatUserError(error));
    }
  }

  const installSkill = useCallback(
    async (skill: Skill) => {
      const result = (await api.installSkill(skill)) as Skill;
      await refresh();
      return result;
    },
    [api, refresh],
  );

  const installSkillPack = useCallback(
    async (packId: string) => {
      const result = (await api.installSkillPack(packId)) as SkillPack;
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
      return (await api.searchSkillCatalog(query, refresh)) as SkillCatalogPage;
    },
    [api],
  );

  const fetchSkillDetail = useCallback(
    async (id: string) => {
      return (await api.fetchSkillDetail(id)) as string | undefined;
    },
    [api],
  );

  // The harness reports this as activity text; nothing else parses it.
  const contextUsage = useMemo(
    () => latestContextUsage(events.map((event) => event.message)),
    [events],
  );

  const steps = activityFromEvents(events, Boolean(activeRun && activeRun.status !== "running"), {
    reasoning: settings?.reasoningSummary,
  });

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
      hasOlderMessages,
      loadingOlder,
      loadOlderMessages,
      runs,
      events,
      artifacts,
      approvals,
      harnesses,
      harnessSessions,
      doctors,
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
      statusText,
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
      attachFiles,
      removeAttachment,
      stashCurrentPrompt,
      restorePromptStash,
      deletePromptStash,
      setPalette,
      setPaletteQuery,
      setNewProjectName,
      setSteerDraft,
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
      status,
      subsystems,
      projects,
      sessions,
      agents,
      skills,
      messages,
      runs,
      events,
      artifacts,
      approvals,
      harnesses,
      harnessSessions,
      doctors,
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
      statusText,
      project,
      session,
      activeRun,
      pendingApproval,
      connected,
      steps,
      git,
      files,
      confirm,
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
