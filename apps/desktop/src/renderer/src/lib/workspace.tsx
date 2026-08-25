import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  Agent,
  AgentMode,
  ApprovalRequest,
  Artifact,
  ChatMessage,
  FileEntry,
  GitStatus,
  HarnessDoctorReport,
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
export type InspectorTab = "files" | "changes" | "diff" | "run" | "agents";

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

export function stepFromEvents(events: RunEvent[]): Array<{ id: string; label: string; status: string }> {
  const labels = [
    { id: "understand", label: "Understanding request" },
    { id: "route", label: "Selecting agent" },
    { id: "skill", label: "Loading skill" },
    { id: "tools", label: "Running tools" },
    { id: "verify", label: "Verifying result" },
  ];
  const seen = new Set(events.map((event) => String(event.data?.step ?? event.type)));
  const activeIndex = labels.findIndex((step) => !events.some((event) => String(event.data?.step) === step.id));
  return labels.map((step, index) => ({
    ...step,
    status:
      seen.has(step.id) && (activeIndex === -1 || index < activeIndex)
        ? "complete"
        : index === activeIndex || (activeIndex === -1 && index === labels.length - 1)
          ? seen.has(step.id) || activeIndex === -1
            ? "complete"
            : "active"
          : "pending",
  }));
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
  steps: Array<{ id: string; label: string; status: string }>;
  setProjectId: (id: string) => void;
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
  createProjectFromFolder: () => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => void;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => void;
  archiveSession: (id: string) => Promise<void>;
  openTerminal: () => Promise<void>;
  openPath: (target: string) => Promise<void>;
  mentionFile: (relative: string) => void;
  spawnHarness: (harnessId: string, prompt?: string) => Promise<void>;
  dedicateHarness: (harnessId: string) => Promise<void>;
  undedicateHarness: () => Promise<void>;
  doctorHarness: (harnessId: string) => Promise<void>;
  cancelHarness: (id?: string) => Promise<void>;
  steerHarness: () => Promise<void>;
  closeHarness: (id?: string) => Promise<void>;
  refreshHarnessStatus: (id?: string) => Promise<void>;
  setHarnessOption: (key: "model" | "permissions" | "cwd" | "mode", value: string) => Promise<void>;
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
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}

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

  const project = projects.find((item) => item.id === projectId);
  const session = sessions.find((item) => item.id === sessionId);
  const activeRun = runs.find(
    (run) => run.sessionId === sessionId && ["running", "approval_required", "waiting"].includes(run.status),
  );
  const pendingApproval = approvals.find((item) => item.status === "pending");
  const connected = status?.state === "connected" && status.kind === "openclaw";

  const loadSession = useCallback(
    async (id: string) => {
      const [nextMessages, nextRuns] = await Promise.all([api.listMessages(id), api.listRuns(id)]);
      setMessages(nextMessages);
      setRuns(nextRuns);
      const latest = nextRuns[0];
      if (latest) {
        setEvents(await api.listRunEvents(latest.id));
        setArtifacts(await api.listArtifacts(latest.id));
      } else {
        setEvents([]);
        setArtifacts([]);
      }
    },
    [api],
  );

  const refresh = useCallback(async () => {
    try {
      const [nextProjects, nextAgents, nextSkills, nextStatus, nextSub, nextApprovals, nextHarnesses] =
        await Promise.all([
          api.listProjects(),
          api.listAgents(),
          api.listSkills(),
          api.getStatus(),
          api.getSubsystemStatus(),
          api.listApprovals("pending"),
          api.listHarnesses(),
        ]);
      setProjects(nextProjects);
      setAgents(nextAgents);
      setSkills(nextSkills);
      setStatus(nextStatus);
      setSubsystems(nextSub);
      setApprovals(nextApprovals);
      setHarnesses(nextHarnesses);
      const selectedProject = projectId ?? nextProjects[0]?.id;
      if (selectedProject && selectedProject !== projectId) setProjectId(selectedProject);
      if (selectedProject) {
        const [nextSessions, nextHarnessSessions] = await Promise.all([
          api.listSessions(selectedProject),
          api.listHarnessSessions(selectedProject),
        ]);
        setSessions(nextSessions);
        setHarnessSessions(nextHarnessSessions);
        if (!sessionId && nextSessions[0]) setSessionId(nextSessions[0].id);
      }
    } catch (error) {
      console.error("Failed to load Capsule state", error);
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [api, projectId, sessionId]);

  useEffect(() => {
    void refresh();
    const off = [
      api.on("connection", () => void refresh()),
      api.on("message", () => {
        if (sessionId) void loadSession(sessionId);
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
        if (command === "harness" || command === "harness-updated" || command === "projects-updated") {
          void refresh();
        }
      }),
    ];
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
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
      if (key === "f" && event.shiftKey) {
        event.preventDefault();
        setContentSearch((open) => !open);
      }
      if (key === "n") {
        event.preventDefault();
        void createTask();
      }
      if (event.key === "\\") {
        event.preventDefault();
        setInspectorOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      off.forEach((fn) => fn());
      window.removeEventListener("keydown", onKey);
    };
  }, [api, loadSession, refresh, sessionId]);

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

  useEffect(() => {
    if (!projectId) {
      setGit(undefined);
      setFiles([]);
      return;
    }
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
          title: "New conversation",
        });
        currentSessionId = created.id;
        setSessionId(created.id);
      }
      if (!currentSessionId) return;
      setDraft("");
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

  async function pickProjectDirectory() {
    if (!projectId) return;
    const directory = await api.pickDirectory();
    if (!directory) return;
    await api.updateProject(projectId, { workingDirectory: directory });
    await refresh();
  }

  async function createProjectFromFolder() {
    const directory = await api.pickDirectory();
    const name =
      newProjectName.trim() ||
      directory?.split("/").filter(Boolean).pop() ||
      "New project";
    const created = await api.createProject({
      name,
      workingDirectory: directory,
    });
    setNewProjectName("");
    setProjectId(created.id);
    setView("chat");
    await refresh();
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
    await api.openTerminal(projectId);
  }

  async function openPath(target: string) {
    await api.openPath(target);
  }

  function mentionFile(relative: string) {
    setDraft((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${relative} `);
    setMode((current) => (current === "chat" ? "code" : current));
  }

  async function spawnHarness(harnessId: string, prompt?: string) {
    if (!projectId) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await api.spawnHarness({
        projectId,
        harnessId,
        prompt,
        cwd: project?.workingDirectory,
      });
      setSessionId(result.session.id);
      setAgentId(harnessId);
      setMode("code");
      setView("chat");
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
    const report = await api.doctorHarness(harnessId);
    setDoctors((current) => ({ ...current, [harnessId]: report }));
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

  async function setHarnessOption(key: "model" | "permissions" | "cwd" | "mode", value: string) {
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

  const steps = stepFromEvents(events);

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
      setProjectId: (id: string) => {
        setProjectId(id);
        void api.listSessions(id).then((next) => {
          setSessions(next);
          setSessionId(next[0]?.id);
        });
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
      createProjectFromFolder,
      renameProject,
      deleteProject,
      renameSession,
      deleteSession,
      archiveSession,
      openTerminal,
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
      refresh,
      loadSession,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
