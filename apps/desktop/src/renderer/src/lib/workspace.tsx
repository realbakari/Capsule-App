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
import type {
  Agent,
  AgentMode,
  ApprovalRequest,
  Artifact,
  CapsuleSettings,
  ChatMessage,
  FileEntry,
  GitStatus,
  HarnessDoctorReport,
  HarnessPermissionProfile,
  HarnessStatus,
  Project,
  Run,
  RunEvent,
  RuntimeStatus,
  Session,
  Skill,
  SubsystemStatus,
} from "@capsule/shared";

export type View = "chat" | "runtimes" | "skills" | "history" | "approvals" | "settings";
export type InspectorTab = "files" | "changes" | "diff" | "run" | "agents" | "term";

export const MODES: AgentMode[] = ["plan", "chat", "agent", "code", "research", "browser", "automation"];
export const PRIMARY_MODES: AgentMode[] = ["plan", "chat", "code"];
export const MORE_MODES: AgentMode[] = ["agent", "research", "browser", "automation"];
export const PERMISSION_OPTIONS = [
  { id: "strict", label: "Supervised" },
  { id: "default", label: "Standard" },
  { id: "approve-all", label: "Full access" },
] as const;

const SIDEBAR_WIDTH_KEY = "capsule.sidebarWidth";
const SIDEBAR_COLLAPSED_KEY = "capsule.sidebarCollapsed";
const INSPECTOR_OPEN_KEY = "capsule.inspectorOpen";
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
  busy: boolean;
  palette: boolean;
  paletteQuery: string;
  newProjectName: string;
  diagnostics: string;
  notice?: string;
  steerDraft: string;
  statusText?: string;
  project?: Project;
  session?: Session;
  activeRun?: Run;
  pendingApproval?: ApprovalRequest;
  connected: boolean;
  steps: RunActivity[];
  setProjectId: (id: string, nextSessionId?: string) => void;
  setSessionId: (id?: string) => void;
  setAgentId: (id: string) => void;
  setMode: (mode: AgentMode) => void;
  setDraft: (value: string) => void;
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
  pickProjectDirectory: () => Promise<void>;
  pickFilesToMention: () => Promise<void>;
  createProjectFromFolder: () => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => void;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => void;
  archiveSession: (id: string) => Promise<void>;
  openTerminal: () => Promise<void>;
  execInProject: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>;
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
  const [status, setStatus] = useState<RuntimeStatus>();
  const [subsystems, setSubsystems] = useState<SubsystemStatus>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
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
  const [sidebarWidth, setSidebarWidthState] = useState(() =>
    Math.min(352, Math.max(220, storedNumber(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH))),
  );
  const [skillId, setSkillId] = useState<string>();
  const [filePicker, setFilePicker] = useState(false);
  const [contentSearch, setContentSearch] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("files");
  const [projectRuns, setProjectRuns] = useState<Run[]>([]);
  const [settings, setSettings] = useState<CapsuleSettings>();
  const settingsDefaultsApplied = useRef(false);

  const project = projects.find((item) => item.id === projectId);
  const session = sessions.find((item) => item.id === sessionId);
  const activeRun = runs.find(
    (run) => run.sessionId === sessionId && ["running", "approval_required", "waiting"].includes(run.status),
  );
  const pendingApproval = approvals.find(
    (item) => item.status === "pending" && runs.some((run) => run.id === item.runId),
  );
  const loadGeneration = useRef(0);
  const connected = status?.state === "connected" && status.kind === "openclaw";

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
        nextStatus,
        nextSub,
        nextApprovals,
        nextHarnesses,
        nextSettings,
      ] = await Promise.all([
          api.listProjects(),
          api.listAgents(),
          api.listSkills(),
          api.getStatus(),
          api.getSubsystemStatus(),
          api.listApprovals("pending"),
          api.listHarnesses(),
          api.getSettings(),
        ]);
      setProjects(nextProjects);
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
        setMode(loaded.defaultMode);
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
      setNotice(error instanceof Error ? error.message : String(error));
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
          command === "projects-updated" ||
          command === "sessions-updated"
        ) {
          void refresh();
        }
        if (command === "git-updated" && projectId) {
          void api.gitStatus(projectId).then(setGit).catch(() => undefined);
        }
      }),
    ];
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const typing =
        event.target instanceof HTMLElement &&
        Boolean(event.target.closest("input, textarea, select, [contenteditable]"));
      const key = event.key.toLowerCase();
      if (typing && key === "n") return;
      if (key === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
      if (key === "b") {
        event.preventDefault();
        setSidebarCollapsed((open) => !open);
      }
      if (key === "p") {
        event.preventDefault();
        setFilePicker((open) => !open);
      }
      if (key === "o") {
        event.preventDefault();
        if (event.shiftKey) void pickFilesToMention();
        else void pickProjectDirectory();
      }
      if (key === "f" && event.shiftKey) {
        event.preventDefault();
        setContentSearch((open) => !open);
      }
      if (key === "n") {
        event.preventDefault();
        void createTask();
      }
      if (key === ",") {
        event.preventDefault();
        setPalette(false);
        setView("settings");
      }
      if (event.key === "\\") {
        event.preventDefault();
        setInspectorOpen((open) => !open);
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
    void api.gitStatus(projectId).then(setGit).catch(() => setGit(undefined));
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
  }, [api, projectId, project?.workingDirectory]);

  async function createTask() {
    const targetProject = projectId ?? projects[0]?.id;
    if (!targetProject) return;
    const created = await api.createSession({
      projectId: targetProject,
      agentId,
      mode,
      permissionProfile: settings?.defaultPermission,
      title: "New conversation",
    });
    setSessionId(created.id);
    setView("chat");
    await refresh();
  }

  async function send() {
    const content = draft.trim();
    if (!content || busy) return;
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
          createdAt: new Date().toISOString(),
        },
      ]);
      setDraft("");
      try {
        await api.sendMessage({
          sessionId: currentSessionId,
          content,
          agentId,
          mode,
          skillId,
        });
        setSkillId(undefined);
        await loadSession(currentSessionId);
        await refresh();
      } catch (error) {
        setDraft(content);
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
        throw error;
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
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

  async function pickProjectDirectory() {
    try {
      const directory = await api.pickDirectory();
      if (!directory) return;
      const name = folderName(directory);
      const target = projectId ?? projects[0]?.id;
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
      setNotice(error instanceof Error ? error.message : String(error));
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
      setNotice(error instanceof Error ? error.message : String(error));
    }
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
      setNotice(error instanceof Error ? error.message : String(error));
    }
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
      await api.openTerminal(projectId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function execInProject(command: string) {
    if (!projectId) throw new Error("No project selected");
    return (await api.execInProject(projectId, command)) as {
      stdout: string;
      stderr: string;
      code: number;
    };
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
        cwd: project?.workingDirectory,
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
      setNotice(error instanceof Error ? error.message : String(error));
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
      setNotice(error instanceof Error ? error.message : String(error));
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
      const next = await api.checkoutBranch(projectId, branch);
      setGit(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
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
    return next;
  }

  async function gitCommit(message: string) {
    if (!projectId) return;
    try {
      setGit(await api.gitCommit(projectId, message));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function gitStage(relative: string) {
    if (!projectId) return;
    try {
      setGit(await api.gitStage(projectId, relative));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
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
          setGit(await api.gitDiscard(projectId, relative));
          setConfirm(undefined);
        })();
      },
    });
  }

  async function gitCreateBranch(branch: string) {
    if (!projectId) return;
    try {
      setGit(await api.gitCreateBranch(projectId, branch));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function gitPush() {
    if (!projectId) return;
    try {
      setGit(await api.gitPush(projectId));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
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
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function gitMergePullRequest() {
    if (!projectId) return;
    try {
      setGit(await api.gitMergePullRequest(projectId));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  const steps = activityFromEvents(events, Boolean(activeRun && activeRun.status !== "running"), {
    reasoning: settings?.reasoningSummary,
  });

  const value = useMemo<WorkspaceValue>(
    () => ({
      api,
      view,
      setView,
      status,
      subsystems,
      projects,
      sessions,
      agents,
      skills,
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
      busy,
      palette,
      paletteQuery,
      newProjectName,
      diagnostics,
      notice,
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
      renameProject,
      deleteProject,
      renameSession,
      deleteSession,
      archiveSession,
      openTerminal,
      execInProject,
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
      busy,
      palette,
      paletteQuery,
      newProjectName,
      diagnostics,
      notice,
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
      refresh,
      loadSession,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
