import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DirectAcpHost,
  isDirectSessionKey,
  supportsDirectMode,
  type AcpReply,
} from "@capsule/acp";
import { agentIdForMode, DEFAULT_AGENTS, excludeSystemAgents } from "@capsule/agents";
import {
  buildDoctorReport,
  clearBinaryCache,
  clearLoginCache,
  harnessAgentRecord,
  isLiveHarnessState,
  localDoctorChecks,
  PRESET_HARNESSES,
  probeLoginStateNow,
  setLoginStateListener,
  presetFor,
  probeHarnesses,
  whichBinary,
} from "@capsule/harness";

import { createBuzzAdapter } from "@capsule/buzz";
import { buildContract } from "@capsule/contracts";
import { readUsageSummary, sinceDaysAgo, type UsageSummary } from "./usage/index.js";
import { CapsuleDatabase, CapsuleRepositories } from "@capsule/database";
import {
  attachmentPromptBlock,
  captureCheckpoint,
  checkoutBranch as checkoutGitBranch,
  checkpointNumstat,
  checkpointRef,
  cloneRepository as cloneGitRepository,
  commitAll,
  createWorktree,
  createBranch as createGitBranch,
  createPullRequest as openPullRequest,
  detectSourceControlTools,
  diffCheckpoints,
  discardFile,
  clearGhCache,
  enrichGitStatus,
  setPullRequestListener,
  FilesystemAdapter,
  initializeRepository,
  lastCommitSubject,
  listLocalServers as discoverLocalServers,
  listPullRequests as discoverPullRequests,
  readPullRequestDetail,
  mergePullRequest as mergeGithubPullRequest,
  pushCurrentBranch,
  readGitDiff,
  readGitStatus,
  readProjectFile,
  readProjectIconDataUrl,
  readPreviewFile,
  previewFromBytes,
  resolveProjectIconPath,
  removeWorktree,
  restoreCheckpoint,
  type ToolStatus,
  searchContents,
  stageFile,
  validateMessageAttachments,
  viewPullRequest,
} from "@capsule/filesystem";
import {
  MockAgentRuntime,
  OpenClawAdapter,
  acpCommandFailed,
  isAcpControlOutput,
  acpxModeIsNonFatal,
  defaultGatewayEndpoint,
} from "@capsule/openclaw";
import { decidePolicy, DEFAULT_POLICIES, policiesFromSettings, recordDecision } from "@capsule/policies";
import { createProjectRecord } from "@capsule/projects";
import { createRunEvent, createRunRecord } from "@capsule/runs";
import { createSessionRecord, titleFromPrompt } from "@capsule/sessions";
import {
  mergeProjectActions,
  acpDoctorCommand,
  acpInstallCommand,
  FILE_CHANGED_ON_DISK,
  fileContentRevision,
  type FilePreview,
  type FileReadResult,
  acpxPermissionMode,
  createId,
  normalizeFolderPath,
  projectFolderList,
  gatewaySessionLabel,
  isAcpSessionKey,
  nowIso,
  type Agent,
  type AgentMessage,
  type AgentMode,
  type AgentRuntime,
  type ApprovalRequest,
  type CapsuleSettings,
  type ChatMessage,
  applyAgentInstructionHints,
  applyBranchPrefix,
  ARCHIVE_INACTIVE_MS,
  DEFAULT_CAPSULE_SETTINGS,
  normalizeCapsuleSettings,
  pullRequestWatchEnabled,
  shouldArchiveInactiveSession,
  SETTINGS_SECTION_KEYS,
  TOKEN_PRESENT_MASK,
  type ConnectionState,
  type CloneRepositoryInput,
  type CreateProjectInput,
  type CreateSessionInput,
  type DiagnosticsSnapshot,
  type ContentHit,
  type FileEntry,
  type GitStatus,
  type GitPullRequest,
  type GitPullRequestDetail,
  type HarnessControlResult,
  type HarnessDoctorReport,
  type HarnessId,
  type HarnessPermissionProfile,
  type HarnessLiveStatus,
  type HarnessOptionPatch,
  type HarnessStatus,
  type LocalServer,
  type MessageAttachment,
  type SpawnHarnessInput,
  type UpdateProjectInput,
  isHarnessId,
  type MessagePage,
  type Project,
  type ProjectActionRun,
  type SearchResults,
  type Run,
  type RunEvent,
  type Session,
  type Skill,
  type SkillPack,
  type SkillCatalogEntry,
  type SkillCatalogPage,
  type SubsystemStatus,
  type WorkspaceMode,
} from "@capsule/shared";
import {
  DEFAULT_SKILLS,
  DEFAULT_SKILL_PACKS,
  SkillCatalogClient,
  SkillsShClient,
  discoverGlobalSkills,
  projectSkillRoots,
  listGlobalSkillFiles,
  resolveGlobalSkillFile,
  skillIdForMode,
} from "@capsule/skills";
import {
  openNativeTerminal,
  runInDirectory,
  startInDirectory,
  type ManagedCommand,
} from "@capsule/terminal";
import { verifyContract } from "@capsule/verification";
import {
  CAPSULE_KEYCHAIN_SERVICE,
  GATEWAY_TOKEN_ACCOUNT,
  SKILLS_SH_TOKEN_ACCOUNT,
  createKeychainAdapter,
  type KeychainAdapter,
} from "./keychain.js";
import {
  INBOX_PROJECT_NAME,
  allocateThreadFolder,
  defaultProjectlessFolder,
  ensureProjectlessFolder,
  isInboxProject,
} from "./projectless.js";

export interface CapsuleEngineOptions {
  databasePath: string;
  userDataDir: string;
  gatewayUrl?: string;
  clientVersion?: string;
  capsuleVersion?: string;
  /**
   * When false the engine runs on the in-process test double and never probes
   * the Gateway. Tests only: nothing in the app sets it.
   */
  autoConnect?: boolean;
}

export interface EngineState {
  projects: Project[];
  sessions: Session[];
  agents: Agent[];
  selectedProjectId?: string;
  selectedSessionId?: string;
}

export class CapsuleEngine {
  readonly events = new EventEmitter();
  readonly db: CapsuleDatabase;
  readonly repos: CapsuleRepositories;
  readonly keychain: KeychainAdapter;
  private workspaceId = "";
  private runtime: AgentRuntime;
  private mock = new MockAgentRuntime();
  private openclaw: OpenClawAdapter;
  /*
   * The route a coding turn takes. In Gateway mode this is the adapter above;
   * in direct mode it is a host that spawns the CLI here and speaks ACP to it.
   * Everything from `spawnHarness` down calls this, not the adapter, so the
   * turn pipeline does not branch on which route carried it.
   */
  private direct = new DirectAcpHost();
  private directUnsub?: () => void;
  private settings: CapsuleSettings;
  private logs: string[] = [];
  private stopped = false;
  /** True only for the in-process test double. Never in a shipped app. */
  private readonly usingMock: boolean;
  private acpBuffers = new Map<string, string>();
  private acpUnsub?: () => void;
  private prWatchers = new Map<string, ReturnType<typeof setInterval>>();
  private prFixFingerprints = new Map<string, string>();
  private prWatchSessions = new Map<string, string>();
  private actionProcesses = new Map<string, ManagedCommand>();
  private actionRuns = new Map<string, ProjectActionRun>();
  private skillsClient: SkillCatalogClient;
  private skillsShClient = new SkillsShClient();

  constructor(private readonly options: CapsuleEngineOptions) {
    this.usingMock = options.autoConnect === false;
    this.db = new CapsuleDatabase(options.databasePath);
    // The GitHub catalog is cached on disk: unauthenticated GitHub allows 60
    // requests an hour for the whole machine, so refetching on every launch
    // (and on every dev restart) is what empties the directory.
    const cachePath = path.join(options.userDataDir, "skill-catalog.json");
    this.skillsClient = new SkillCatalogClient(undefined, undefined, undefined, {
      read: () => {
        try {
          return JSON.parse(readFileSync(cachePath, "utf8")) as SkillCatalogPage;
        } catch {
          return undefined;
        }
      },
      write: (page) => {
        try {
          mkdirSync(path.dirname(cachePath), { recursive: true });
          writeFileSync(cachePath, JSON.stringify(page));
        } catch {
          // A cache we cannot write is a slower directory, not a failure.
        }
      },
    });
    this.repos = new CapsuleRepositories(this.db);
    this.keychain = createKeychainAdapter(options.userDataDir);
    this.settings = normalizeCapsuleSettings({
      ...DEFAULT_CAPSULE_SETTINGS,
      gatewayUrl: options.gatewayUrl ?? defaultGatewayEndpoint().url,
    });
    this.openclaw = this.createOpenClawAdapter();
    this.runtime = this.mock;
  }

  async start(): Promise<void> {
    // A background sign-in probe that lands with a different answer has to
    // reach the UI, or the harness list stays wrong until something else
    // happens to refresh it.
    setLoginStateListener(() => {
      if (!this.stopped) this.events.emit("state", { command: "harness-updated" });
    });
    setPullRequestListener(() => {
      if (!this.stopped) this.events.emit("state", { command: "git-updated" });
    });
    this.bootstrapWorkspace();
    this.loadSettings();
    this.bindInboxToProjectless();
    this.applyWorkspacePolicies();
    this.failStaleRuns();
    this.archiveInactiveSessions();
    await this.hydrateSecrets();
    this.openclaw = this.createOpenClawAdapter();
    await this.connectPreferredRuntime();
    this.bindAcpReplies();
    this.log("Capsule engine started");
  }

  async stop(): Promise<void> {
    // Runtime subscriptions can outlive stop() — a cancelled or failed turn
    // keeps draining queued events — and every handler writes to the database.
    // Mark the engine stopped before closing so late events are dropped rather
    // than throwing "The database connection is not open" from a detached
    // promise, which surfaces as an unhandled rejection with no run to blame.
    this.stopped = true;
    setLoginStateListener(undefined);
    setPullRequestListener(undefined);
    this.directUnsub?.();
    // Agents Capsule spawned are Capsule's to stop; nothing else will.
    void this.direct.closeAll();
    this.stopAllPrWatch();
    for (const process of this.actionProcesses.values()) process.stop();
    this.actionProcesses.clear();
    this.acpUnsub?.();
    await this.runtime.disconnect().catch(() => undefined);
    this.db.close();
  }

  async getSubsystemStatus(): Promise<SubsystemStatus> {
    const runtimeStatus = await this.runtime.getStatus().catch(() => undefined);
    const buzz = createBuzzAdapter(() => this.runtime.listChannels());
    return {
      capsuleCore: "connected",
      openclawGateway: this.usingMock ? "disconnected" : (runtimeStatus?.state ?? "disconnected"),
      buzz: await buzz.getStatus().catch(() => "disconnected" as ConnectionState),
      database: "connected",
      keychain: "connected",
    };
  }

  async getStatus() {
    return this.runtime.getStatus();
  }

  async connectGateway(url?: string): Promise<void> {
    if (url) {
      this.settings.gatewayUrl = url;
      this.persistSettings();
    }
    this.openclaw = this.createOpenClawAdapter();
    try {
      await this.openclaw.connect();
      this.runtime = this.openclaw;
      await this.syncRuntimeCatalog();
      this.bindAcpReplies();
      this.log(`Connected to OpenClaw Gateway at ${this.settings.gatewayUrl}`);
      this.events.emit("connection", await this.runtime.getStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Gateway connect failed: ${message}`);
      throw error;
    }
  }

  async disconnectGateway(): Promise<void> {
    await this.runtime.disconnect();
    this.events.emit("connection", await this.getStatus());
  }

  listProjects(): Project[] {
    return this.repos.listProjects().map((project) => this.withProjectIcon(project));
  }

  createProject(input: CreateProjectInput): Project {
    const project = createProjectRecord(this.workspaceId, input);
    if (isInboxProject(project) && !project.workingDirectory) {
      project.workingDirectory = ensureProjectlessFolder(this.projectlessRoot());
    }
    this.repos.insertProject(project);
    return project;
  }

  async cloneRepository(input: CloneRepositoryInput): Promise<Project> {
    const result = await cloneGitRepository(input.parentDirectory, input.url, input.name);
    if (!result.ok || !result.path || !result.name) throw new Error(result.detail);
    const project = this.createProject({ name: result.name, workingDirectory: result.path });
    this.events.emit("state", { command: "projects-updated" });
    return this.withProjectIcon(project);
  }

  getProject(id: string): Project | undefined {
    const project = this.repos.getProject(id);
    return project ? this.withProjectIcon(project) : undefined;
  }

  async listAgents(): Promise<Agent[]> {
    const stored = this.repos.listAgents();
    // Bootstrap agents are only a mock-runtime fallback. Once connected, showing
    // a stale `general`/`coding` mock record lets the renderer select an agent
    // that the Gateway cannot actually run, which then silently falls back to
    // the Gateway main agent.
    const runtimeAgents = this.usingMock
      ? stored.length > 0
        ? stored
        : DEFAULT_AGENTS
      : stored.filter((agent) => agent.runtime === "openclaw");
    const base = excludeSystemAgents(runtimeAgents);
    const harnesses = await this.listHarnesses();
    const extra = harnesses
      .filter((harness) => !base.some((agent) => agent.id === harness.id))
      .filter(
        (harness) =>
          harness.id === "claude" ||
          harness.id === "codex" ||
          Boolean(harness.binaryPath) ||
          harness.dedicatedProjectIds.length > 0 ||
          harness.liveSessionIds.length > 0,
      )
      .map((harness) =>
        harnessAgentRecord(PRESET_HARNESSES.find((preset) => preset.id === harness.id)!),
      );
    return [...base, ...extra];
  }

  /*
   * One listing per tick, however many callers ask.
   *
   * A refresh asks for the agent list and the harness list together, and the
   * agent list is derived from the harness list — so every refresh probed all
   * nineteen presets and asked the Gateway about acpx twice over, for one
   * answer.
   */
  private harnessListingInFlight: Promise<HarnessStatus[]> | undefined;

  /*
   * Whether acpx is installed, remembered for a while.
   *
   * Asking costs three Gateway round trips — health, the whole config, and the
   * plugin list — and the config read validates every plugin's schema. The
   * answer changes when someone installs a plugin, not between two frames of a
   * streaming turn, and Capsule clears this itself when it writes that config.
   */
  private acpxEnabledCache: { value: boolean; at: number } | undefined;

  private static readonly ACPX_CACHE_TTL_MS = 30_000;

  private async acpxEnabled(): Promise<boolean> {
    if (this.usingMock) return false;
    const cached = this.acpxEnabledCache;
    if (cached && Date.now() - cached.at < CapsuleEngine.ACPX_CACHE_TTL_MS) return cached.value;
    const value = await this.openclaw.hasAcpxPlugin().catch(() => false);
    this.acpxEnabledCache = { value, at: Date.now() };
    return value;
  }

  private forgetAcpxState(): void {
    this.acpxEnabledCache = undefined;
  }

  async listHarnesses(): Promise<HarnessStatus[]> {
    if (this.harnessListingInFlight) return this.harnessListingInFlight;
    const listing = this.readHarnesses().finally(() => {
      this.harnessListingInFlight = undefined;
    });
    this.harnessListingInFlight = listing;
    return listing;
  }

  private async readHarnesses(): Promise<HarnessStatus[]> {
    const dedicatedByHarness: Record<string, string[]> = Object.fromEntries(
      PRESET_HARNESSES.map((preset) => [preset.id, [] as string[]]),
    );
    const liveByHarness: Record<string, string[]> = Object.fromEntries(
      PRESET_HARNESSES.map((preset) => [preset.id, [] as string[]]),
    );
    for (const project of this.repos.listProjects()) {
      if (project.defaultAgentId && isHarnessId(project.defaultAgentId)) {
        dedicatedByHarness[project.defaultAgentId]?.push(project.id);
      }
    }
    for (const session of this.repos.listSessions()) {
      const harnessId = session.harnessId && isHarnessId(session.harnessId) ? session.harnessId : undefined;
      if (harnessId && isLiveHarnessState(session.harnessState) && session.state === "active") {
        liveByHarness[harnessId]?.push(session.id);
      }
    }
    const acpxEnabled = await this.acpxEnabled();
    return probeHarnesses({
      gatewayConnected: !this.usingMock,
      acpxEnabled,
      dedicatedByHarness,
      liveByHarness,
    });
  }

  async doctorHarness(harnessId: HarnessId): Promise<HarnessDoctorReport> {
    const preset = presetFor(harnessId);
    if (!preset) throw new Error(`Unknown harness: ${harnessId}`);
    // Explicit environment re-check: drop cached lookups so a CLI installed —
    // or signed into — since launch is picked up.
    clearBinaryCache();
    clearLoginCache();
    clearGhCache();
    this.forgetAcpxState();
    const direct = this.useDirectMode(harnessId);
    const acpxEnabled = direct ? false : await this.acpxEnabled();
    const binaryPath = whichBinary(preset.binaries);
    let acpxPermissionModeValue: string | undefined;
    let acpxPolicyKnown = false;
    let acpxAgentConfigured: boolean | undefined = preset.acpxCommand ? false : undefined;
    let acpxAgentError: string | undefined;
    if (!this.usingMock && !direct && acpxEnabled) {
      if (preset.acpxCommand) {
        const result = await this.openclaw.ensureAcpxAgentCommand(
          preset.openclawAgentId,
          preset.acpxCommand,
        );
        acpxAgentConfigured = result.already || result.applied;
        acpxAgentError = result.error;
      }
      try {
        let policy = await this.openclaw.readAcpxHarnessPolicy();
        acpxPolicyKnown = true;
        // Fix the fatal default (approve-reads). Leave deny-all alone — that is Supervised.
        if (!acpxModeIsNonFatal(policy.permissionMode)) {
          await this.openclaw.ensureAcpxHeadlessWrites().catch(() => undefined);
          policy = await this.openclaw.readAcpxHarnessPolicy();
        }
        acpxPermissionModeValue = policy.permissionMode;
      } catch {
        acpxPolicyKnown = false;
      }
    }
    const checks = localDoctorChecks({
      preset,
      binaryPath,
      gatewayConnected: !this.usingMock,
      acpxEnabled,
      loginState: this.usingMock ? undefined : probeLoginStateNow(preset, binaryPath),
      acpxPermissionMode: acpxPermissionModeValue,
      acpxPolicyKnown,
      acpxAgentConfigured,
      acpxAgentError,
      direct,
    });
    let gatewayOutput: string | undefined;
    if (!this.usingMock && !direct) {
      try {
        const scratch = await this.openclaw.createSession({
          projectId: this.repos.listProjects()[0]?.id ?? "local",
          title: `${preset.name} doctor`,
          mode: "code",
        });
        const key = scratch.openclawSessionKey ?? scratch.id;
        gatewayOutput = await this.acpHost(key).doctorAcp(key);
        if (!acpxEnabled) {
          const install = await this.openclaw.acpCommand(key, acpInstallCommand(), { waitMs: 8_000 });
          if (install.text) {
            gatewayOutput = [gatewayOutput, install.text].filter(Boolean).join("\n");
          }
        }
      } catch (error) {
        gatewayOutput = `Gateway ${acpDoctorCommand()} failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const report = buildDoctorReport({ harnessId, checks, gatewayOutput });
    this.log(`Doctor ${preset.name}: ${report.ready ? "ready" : "blocked"}`);
    return report;
  }

  async dedicateHarness(projectId: string, harnessId: HarnessId): Promise<Project> {
    const project = this.requireProject(projectId);
    const preset = presetFor(harnessId);
    if (!preset) throw new Error(`Unknown harness: ${harnessId}`);
    this.repos.upsertAgent(harnessAgentRecord(preset));
    project.defaultAgentId = harnessId;
    project.defaultMode = "code";
    project.updatedAt = nowIso();
    this.repos.updateProject(project);
    this.log(`Dedicated ${preset.name} to project ${project.name}`);
    this.events.emit("state", { command: "harness-updated" });
    return project;
  }

  async undedicateHarness(projectId: string): Promise<Project> {
    const project = this.requireProject(projectId);
    if (project.defaultAgentId && isHarnessId(project.defaultAgentId)) {
      this.log(`Removed ${project.defaultAgentId} dedication from ${project.name}`);
      project.defaultAgentId = undefined;
      project.defaultMode = "chat";
      project.updatedAt = nowIso();
      this.repos.updateProject(project);
    }
    this.events.emit("state", { command: "harness-updated" });
    return project;
  }

  async spawnHarness(input: SpawnHarnessInput): Promise<HarnessControlResult> {
    const { projectId, harnessId } = input;
    const project = await this.dedicateHarness(projectId, harnessId);
    const preset = presetFor(harnessId)!;
    /*
     * Refuse before spawning rather than letting the turn die mid-flight with
     * an opaque ACP "Authentication required". Only a definite verdict blocks:
     * an unrunnable probe returns "unknown" and must not gate a working
     * harness.
     */
    const direct = this.useDirectMode(harnessId);
    if (!this.usingMock) {
      // Direct mode spawns the CLI here, so there is no Gateway config to
      // write and nothing to register a command with.
      if (preset.acpxCommand && !direct) {
        const configured = await this.openclaw.ensureAcpxAgentCommand(
          preset.openclawAgentId,
          preset.acpxCommand,
        );
        if (configured.applied) this.forgetAcpxState();
        if (!configured.already && !configured.applied) {
          throw new Error(
            `Could not register ${preset.name}'s ACP command with OpenClaw: ${configured.error ?? "Gateway rejected the acpx agent configuration."}`,
          );
        }
      }
      const loginState = probeLoginStateNow(preset, whichBinary(preset.binaries));
      if (loginState === "logged_out") {
        throw new Error(
          `${preset.name} is installed but not signed in. ${preset.loginHint ?? "Sign in to its CLI"} on the Gateway host, then run Doctor.`,
        );
      }
      if (loginState === "config_invalid") {
        throw new Error(
          `${preset.name}'s CLI config could not be read. Fix it, then run Doctor.`,
        );
      }
    }
    if (input.sessionId && this.requireSession(input.sessionId).projectId !== project.id) {
      throw new Error("Harness session must belong to the selected project.");
    }
    const title = input.sessionId
      ? this.requireSession(input.sessionId).title
      : `${preset.name} · ${project.name}`;
    const session = input.sessionId
      ? this.requireSession(input.sessionId)
      : createSessionRecord(
          project,
          {
            projectId: project.id,
            agentId: harnessId,
            mode: "code",
            title,
            workspaceMode:
              !isInboxProject(project) &&
              this.settings.defaultWorkspaceMode === "worktree" &&
              readGitStatus(project.workingDirectory).isRepo
                ? "worktree"
                : "local",
          },
          harnessId,
        );
    if (!session.workingDirectory && isInboxProject(project)) {
      session.workingDirectory = allocateThreadFolder(
        ensureProjectlessFolder(this.projectlessRoot()),
        title,
      );
    }
    if (!input.sessionId && session.workspaceMode === "worktree") {
      this.attachSessionWorktree(session, project);
    }
    const cwd = session.workingDirectory ?? input.cwd ?? project.workingDirectory;

    session.agentId = harnessId;
    session.mode = "code";
    session.harnessId = harnessId;
    session.harnessState = "spawning";
    session.acpMode = input.mode ?? "persistent";
    const permissionProfile = input.permissionProfile ?? this.settings.defaultPermission;
    session.permissionProfile = permissionProfile;
    session.modelOverride = input.model;
    session.updatedAt = nowIso();

    if (this.usingMock) {
      session.harnessState = "running";
      session.openclawSessionKey = session.openclawSessionKey ?? `mock:acp:${harnessId}:${session.id}`;
      if (input.sessionId) this.repos.updateSession(session);
      else this.repos.insertSession(session);
      this.log(`Mock spawn for ${harnessId}; connect OpenClaw to run a real ACP session.`);
      this.events.emit("state", { command: "harness-updated" });
      return {
        session,
        usedSlashCommand: false,
        detail:
          "Mock session only. Connect the OpenClaw Gateway and enable acpx, then spawn again for a real coding-agent run.",
      };
    }

    try {
      const spawned = direct
        ? await this.direct.spawnAcpSession({
            harnessId,
            cwd,
            title,
            prompt: input.prompt,
            sessionKey: session.openclawSessionKey,
            model: input.model,
          })
        : await this.openclaw.spawnAcpSession({
            harnessId,
            cwd,
            title,
            prompt: input.prompt,
            mode: input.mode ?? "persistent",
            sessionKey: session.openclawSessionKey,
            permissionProfile,
            model: input.model,
          });
      session.openclawSessionKey = spawned.sessionKey;
      session.harnessState = "running";
      if (input.sessionId) this.repos.updateSession(session);
      else this.repos.insertSession(session);
      this.log(`Spawned OpenClaw ACP session for ${harnessId} (${spawned.sessionKey})`);
      this.events.emit("state", { command: "harness-updated" });
      return {
        session,
        command: spawned.command,
        usedSlashCommand: spawned.usedSlashCommand,
        detail: `ACP session ${spawned.sessionKey}`,
      };
    } catch (error) {
      session.harnessState = "error";
      if (input.sessionId) this.repos.updateSession(session);
      else this.repos.insertSession(session);
      throw error;
    }
  }

  async cancelHarness(sessionId: string): Promise<HarnessControlResult> {
    const session = this.requireHarnessSession(sessionId);
    // Cancelling a closed session used to write back "waiting", which
    // isLiveHarnessState counts as live — resurrecting a dead ACP session in
    // listHarnesses and in the conversation's harness bar.
    if (!isLiveHarnessState(session.harnessState)) {
      return { session, command: "/acp cancel", detail: "No in-flight turn to cancel." };
    }
    const run = this.listRuns(session.id).find((item) =>
      ["running", "waiting", "approval_required"].includes(item.status),
    );
    if (this.usingMock) {
      if (run) await this.stopRun(run.id);
    } else if (session.openclawSessionKey) {
      try {
        await this.acpHost(session.openclawSessionKey).cancelAcp(
          session.openclawSessionKey,
          run?.openclawRunId,
        );
      } catch (error) {
        session.harnessState = "error";
        session.updatedAt = nowIso();
        this.repos.updateSession(session);
        this.events.emit("state", { command: "harness-updated" });
        throw error;
      }
      if (run) {
        run.status = "cancelled";
        run.updatedAt = nowIso();
        run.completedAt = nowIso();
        this.repos.updateRun(run);
      }
    }
    session.harnessState = "waiting";
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    this.log(`Cancelled harness turn for ${session.title}`);
    this.events.emit("run", run);
    return { session, command: "/acp cancel", detail: "Cancelled in-flight turn." };
  }

  async steerHarness(sessionId: string, instruction: string): Promise<HarnessControlResult> {
    const session = this.requireHarnessSession(sessionId);
    const text = instruction.trim();
    if (!text) throw new Error("Steer instruction is empty");
    if (!this.usingMock && session.openclawSessionKey) {
      await this.acpHost(session.openclawSessionKey).steerAcp(session.openclawSessionKey, text);
    }
    const userMessage: ChatMessage = {
      id: createId("msg"),
      sessionId: session.id,
      role: "user",
      content: text,
      kind: "steer",
      createdAt: nowIso(),
    };
    this.repos.insertMessage(userMessage);
    session.harnessState = "running";
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    this.events.emit("message", userMessage);
    this.log(`Steered ${session.harnessId} session ${session.id}`);
    return { session, command: `/acp steer ${text}`, detail: "Steer sent." };
  }

  async closeHarness(sessionId: string): Promise<HarnessControlResult> {
    const session = this.requireHarnessSession(sessionId);
    if (!this.usingMock && session.openclawSessionKey) {
      try {
        await this.acpHost(session.openclawSessionKey).closeAcp(session.openclawSessionKey);
      } catch (error) {
        session.harnessState = "error";
        session.updatedAt = nowIso();
        this.repos.updateSession(session);
        this.events.emit("state", { command: "harness-updated" });
        throw error;
      }
    }
    session.harnessState = "closed";
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    if (session.openclawSessionKey) this.acpBuffers.delete(session.openclawSessionKey);
    this.log(`Closed harness session ${session.id}`);
    this.events.emit("state", { command: "harness-updated" });
    return { session, command: "/acp close", detail: "ACP session closed." };
  }

  async harnessStatus(sessionId: string): Promise<HarnessLiveStatus> {
    const session = this.requireSession(sessionId);
    if (this.usingMock || !session.openclawSessionKey) {
      return {
        session,
        harnessId: session.harnessId,
        state: session.harnessState ?? "idle",
        openclawSessionKey: session.openclawSessionKey,
        statusText: this.usingMock
          ? `Mock ${session.harnessId ?? "harness"} · ${session.harnessState ?? "idle"}`
          : "No OpenClaw session key yet.",
      };
    }
    const result = await this.acpHost(session.openclawSessionKey).statusAcp(session.openclawSessionKey);
    const statusState = result.parsed.state?.toLowerCase();
    if (statusState === "running" || statusState === "idle" || statusState === "waiting") {
      session.harnessState = statusState === "running" ? "running" : "waiting";
      session.updatedAt = nowIso();
      this.repos.updateSession(session);
    } else if (statusState === "closed" || statusState === "stopped") {
      session.harnessState = "closed";
      session.updatedAt = nowIso();
      this.repos.updateSession(session);
    } else if (statusState === "error" || statusState === "failed") {
      session.harnessState = "error";
      session.updatedAt = nowIso();
      this.repos.updateSession(session);
    }
    return {
      session,
      harnessId: session.harnessId,
      state: session.harnessState ?? "running",
      openclawSessionKey: session.openclawSessionKey,
      statusText: result.text,
      parsed: result.parsed,
    };
  }

  async setHarnessOption(patch: HarnessOptionPatch): Promise<HarnessControlResult> {
    const session = this.requireHarnessSession(patch.sessionId);
    const value = patch.value.trim();
    if (!value) throw new Error("Option value is empty");
    let statusText: string | undefined;
    if (!this.usingMock && session.openclawSessionKey) {
      if (patch.key === "permissions") {
        await this.openclaw
          .ensureAcpxPermissionMode(acpxPermissionMode(value))
          .catch(() => undefined);
      }
      statusText = await this.acpHost(session.openclawSessionKey).setAcpOption(
        session.openclawSessionKey,
        patch.key,
        value,
      );
    }
    if (patch.key === "model") session.modelOverride = value;
    if (patch.key === "permissions") session.permissionProfile = value;
    if (patch.key === "cwd") {
      const project = this.requireProject(session.projectId);
      project.workingDirectory = value;
      project.updatedAt = nowIso();
      this.repos.updateProject(project);
    }
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    this.log(`Set harness ${patch.key}=${value} on ${session.id}`);
    return { session, detail: `Updated ${patch.key}.`, statusText };
  }

  listHarnessSessions(projectId?: string): Session[] {
    return this.repos
      .listSessions(projectId)
      .filter(
        (session) =>
          Boolean(session.harnessId) && session.state === "active" && isLiveHarnessState(session.harnessState),
      );
  }

  updateProject(id: string, patch: UpdateProjectInput): Project {
    const project = this.requireProject(id);
    if (patch.name !== undefined) project.name = patch.name.trim() || project.name;
    if (patch.description !== undefined) project.description = patch.description;
    if (patch.workingDirectory !== undefined) {
      project.workingDirectory = patch.workingDirectory ?? undefined;
    }
    if (patch.extraFolders !== undefined) {
      project.extraFolders = patch.extraFolders.length > 0 ? patch.extraFolders : undefined;
    }
    if (patch.actions !== undefined) {
      project.actions = patch.actions
        .map((action) => ({
          id: action.id.trim().slice(0, 80),
          name: action.name.trim().slice(0, 60),
          command: action.command.trim().slice(0, 2_000),
          ...(action.previewUrl?.trim()
            ? { previewUrl: action.previewUrl.trim().slice(0, 500) }
            : {}),
          ...(action.runOnWorktreeCreate ? { runOnWorktreeCreate: true } : {}),
          // Stored only when it is off: an action with a preview URL opened it
          // before this was a choice, and that stays the default.
          ...(action.openPreview === false ? { openPreview: false } : {}),
        }))
        .filter((action) => action.id && action.name && action.command)
        .slice(0, 24);
      if (project.actions.length === 0) project.actions = undefined;
    }
    if (patch.iconPath !== undefined) {
      const requested = patch.iconPath?.trim();
      if (requested && !resolveProjectIconPath(project.workingDirectory, requested)) {
        throw new Error("Choose an SVG, PNG, ICO, JPEG, GIF, AVIF, or WebP image under 2 MB.");
      }
      project.iconPath = requested || undefined;
    }
    if (patch.defaultAgentId !== undefined) {
      project.defaultAgentId = patch.defaultAgentId ?? undefined;
    }
    if (patch.defaultMode !== undefined) project.defaultMode = patch.defaultMode;
    if (patch.defaultWorkspaceMode !== undefined) {
      project.defaultWorkspaceMode = patch.defaultWorkspaceMode ?? undefined;
    }
    project.updatedAt = nowIso();
    this.repos.updateProject(project);
    return project;
  }

  deleteProject(id: string): void {
    const project = this.requireProject(id);
    for (const run of this.listProjectActionRuns(id)) {
      if (run.status === "running") this.stopProjectAction(id, run.actionId, run.sessionId);
    }
    for (const session of this.repos.listSessions(id)) {
      this.cleanupSessionWorktree(session, project);
    }
    this.repos.deleteProject(id);
    if (this.repos.listProjects().length === 0) {
      this.createProject({
        name: INBOX_PROJECT_NAME,
        description: "Tasks started outside a project.",
      });
    }
    this.events.emit("state", { command: "projects-updated" });
  }

  gitStatus(projectId: string, sessionId?: string): GitStatus {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    const status = enrichGitStatus(
      readGitStatus(cwd),
      cwd,
    );
    if (status.pullRequest && pullRequestWatchEnabled(this.settings)) {
      this.schedulePrWatch(projectId);
    } else if (!status.pullRequest) {
      this.stopPrWatch(projectId);
    }
    return status;
  }

  /** `undefined` when the host could not be asked; an array when it answered. */
  listPullRequests(projectId: string, sessionId?: string): GitPullRequest[] | undefined {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd || !readGitStatus(cwd).isRepo) return [];
    return discoverPullRequests(cwd);
  }

  pullRequestDetail(projectId: string, number: number, sessionId?: string): GitPullRequestDetail | undefined {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd || !readGitStatus(cwd).isRepo) return undefined;
    return readPullRequestDetail(cwd, number);
  }

  gitDiff(projectId: string, relative?: string, sessionId?: string): string {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd) return "";
    return readGitDiff(cwd, relative);
  }

  checkoutBranch(projectId: string, branch: string, sessionId?: string): GitStatus {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd) throw new Error("Project has no working directory");
    const result = checkoutGitBranch(cwd, branch);
    if (!result.ok) throw new Error(result.detail);
    return readGitStatus(cwd);
  }

  gitCommit(projectId: string, message: string, sessionId?: string): GitStatus {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd) throw new Error("Project has no working directory");
    const result = commitAll(cwd, message);
    if (!result.ok) throw new Error(result.detail);
    return this.gitStatus(projectId, sessionId);
  }

  gitStage(projectId: string, relative: string, sessionId?: string): GitStatus {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd) throw new Error("Project has no working directory");
    const result = stageFile(cwd, relative);
    if (!result.ok) throw new Error(result.detail);
    return readGitStatus(cwd);
  }

  gitDiscard(projectId: string, relative: string, sessionId?: string): GitStatus {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd) throw new Error("Project has no working directory");
    const result = discardFile(cwd, relative);
    if (!result.ok) throw new Error(result.detail);
    return readGitStatus(cwd);
  }

  gitCreateBranch(projectId: string, branch: string, sessionId?: string): GitStatus {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd) throw new Error("Project has no working directory");
    const result = createGitBranch(
      cwd,
      applyBranchPrefix(this.settings.branchPrefix, branch),
    );
    if (!result.ok) throw new Error(result.detail);
    return this.gitStatus(projectId, sessionId);
  }

  gitPush(projectId: string, sessionId?: string): GitStatus {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd) throw new Error("Project has no working directory");
    const result = pushCurrentBranch(cwd, this.settings.gitForceWithLease);
    if (!result.ok) throw new Error(result.detail);
    this.log(result.detail);
    return this.gitStatus(projectId, sessionId);
  }

  async gitCreatePullRequest(
    projectId: string,
    input?: { title?: string; body?: string; sessionId?: string },
  ): Promise<GitStatus> {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, input?.sessionId);
    if (!cwd) throw new Error("Project has no working directory");
    const pushed = pushCurrentBranch(cwd, this.settings.gitForceWithLease);
    if (!pushed.ok) throw new Error(pushed.detail);
    const branch = readGitStatus(cwd).branch ?? "HEAD";
    const title =
      input?.title?.trim() ||
      lastCommitSubject(cwd) ||
      branch.replace(/^.*\//, "").replace(/[-_]/g, " ");
    const body =
      [input?.body?.trim(), this.settings.prInstructions].filter(Boolean).join("\n\n") || title;
    const opened = openPullRequest(cwd, {
      title,
      body,
      draft: this.settings.prDraft,
    });
    if (!opened.ok) throw new Error(opened.detail);
    this.log(opened.detail);
    if (input?.sessionId) this.prWatchSessions.set(projectId, input.sessionId);
    if (this.settings.prAutoMerge) {
      const queued = mergeGithubPullRequest(
        cwd,
        this.settings.prMergeMethod,
        true,
      );
      this.log(queued.detail);
    }
    if (pullRequestWatchEnabled(this.settings)) this.schedulePrWatch(projectId, input?.sessionId);
    return this.gitStatus(projectId, input?.sessionId);
  }

  gitMergePullRequest(projectId: string, sessionId?: string): GitStatus {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd) throw new Error("Project has no working directory");
    const result = mergeGithubPullRequest(
      cwd,
      this.settings.prMergeMethod,
      this.settings.prAutoMerge,
    );
    if (!result.ok) throw new Error(result.detail);
    this.log(result.detail);
    return this.gitStatus(projectId, sessionId);
  }

  gitInit(projectId: string): GitStatus {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Choose a project folder first");
    const result = initializeRepository(project.workingDirectory);
    if (!result.ok) throw new Error(result.detail);
    this.log(result.detail);
    this.events.emit("state", { command: "git-updated" });
    return this.gitStatus(projectId);
  }

  async localServers(): Promise<LocalServer[]> {
    return discoverLocalServers();
  }

  searchContents(projectId: string, query: string): ContentHit[] {
    const project = this.requireProject(projectId);
    return searchContents(project.workingDirectory, query);
  }

  /**
   * Every skill this workspace can reach: the ones installed on this Mac, the
   * ones checked into the open project, and Capsule's own.
   *
   * A project's skills come last of the discovered ones so an installed skill
   * of the same name keeps its place — the CLIs resolve collisions the same
   * way, and a picker that disagreed with the agent would offer something it
   * then refuses to run.
   */
  async listSkills(projectId?: string): Promise<Skill[]> {
    const stored = this.repos.listSkills();
    const capsuleSkills = stored.length > 0 ? stored : DEFAULT_SKILLS;
    const project = projectId ? this.repos.getProject(projectId) : undefined;
    const installed = discoverGlobalSkills();
    const fromProject = discoverGlobalSkills(projectSkillRoots(project?.workingDirectory)).filter(
      (skill) => !installed.some((candidate) => candidate.name === skill.name),
    );
    return [...installed, ...fromProject, ...capsuleSkills];
  }

  private async requireSkill(skillId: string): Promise<Skill> {
    const skill = (await this.listSkills()).find((entry) => entry.id === skillId);
    if (!skill) throw new Error(`Unknown skill: ${skillId}`);
    return skill;
  }

  /** List files owned by one installed skill, never an arbitrary path. */
  async listSkillFiles(skillId: string, relative = "."): Promise<FileEntry[]> {
    const skill = await this.requireSkill(skillId);
    if (skill.location) return listGlobalSkillFiles(skill.location, relative);
    if (relative !== ".") return [];
    return skill.content ? [{ name: "SKILL.md", path: "SKILL.md", type: "file" }] : [];
  }

  /** Read-only preview scoped to the selected skill's own folder. */
  async previewSkillFile(skillId: string, relative: string): Promise<FilePreview> {
    const skill = await this.requireSkill(skillId);
    if (skill.location) {
      return readPreviewFile(resolveGlobalSkillFile(skill.location, relative), relative);
    }
    if (relative !== "SKILL.md" || !skill.content) throw new Error("Skill file not found");
    return previewFromBytes("SKILL.md", Buffer.from(skill.content, "utf8"));
  }

  listSkillPacks(): SkillPack[] {
    const stored = this.repos.listSkillPacks();
    return stored.length > 0 ? stored : DEFAULT_SKILL_PACKS;
  }

  installSkill(skill: Skill): Skill {
    const normalized: Skill = {
      ...skill,
      status: "installed",
      requirements: skill.requirements ?? [],
      permissions: skill.permissions ?? { filesystem: "approval" },
      validation: "passed",
    };
    this.repos.upsertSkill(normalized);
    this.events.emit("state", { command: "skills-updated" });
    return normalized;
  }

  installSkillPack(packId: string): SkillPack {
    const defaultPack = DEFAULT_SKILL_PACKS.find((p) => p.id === packId);
    if (!defaultPack) {
      throw new Error(`Unknown skill pack: ${packId}`);
    }
    this.repos.upsertSkillPack(defaultPack);
    for (const skill of DEFAULT_SKILLS.filter((s) => s.packId === packId)) {
      this.repos.upsertSkill({ ...skill, status: "installed" });
    }
    this.events.emit("state", { command: "skills-updated" });
    return defaultPack;
  }

  uninstallSkill(skillId: string): void {
    const existing = this.repos.getSkill(skillId);
    if (existing) {
      this.repos.upsertSkill({ ...existing, status: "available" });
      this.events.emit("state", { command: "skills-updated" });
    }
  }

  /**
   * Browse or filter the live skill catalog. An empty query returns everything
   * that was fetched; failures are carried on the page rather than swallowed,
   * so the directory can say why it is short.
   */
  async searchSkillCatalog(query: string, refresh = false): Promise<SkillCatalogPage> {
    const base = await this.skillsClient.search(query, refresh);
    const connected = this.skillsShClient.hasToken();
    const page: SkillCatalogPage = { ...base, skillsShConnected: connected };
    if (!connected) return page;

    // With a token configured, skills.sh results are merged in ahead of the
    // GitHub ones — it reports install counts, which GitHub cannot. A failure
    // there is added to the page's errors so the directory can say the token
    // was rejected instead of silently showing the GitHub list alone.
    try {
      const trimmed = query.trim();
      const results = trimmed
        ? await this.skillsShClient.searchStrict(trimmed)
        : await this.skillsShClient.leaderboardStrict();
      const mapped: SkillCatalogEntry[] = results.map((result) => ({
        id: `${result.source}/${result.slug || result.id}`,
        name: result.name || result.slug,
        source: result.source,
        url: result.url,
        description: result.description,
        installs: result.installs,
        origin: "skills.sh",
      }));
      const seen = new Set(mapped.map((entry) => entry.id));
      return {
        ...page,
        entries: [...mapped, ...page.entries.filter((entry) => !seen.has(entry.id))],
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ...page, errors: [...page.errors, reason] };
    }
  }

  /** Which source-control tools are on this machine, and what to do about gaps. */
  sourceControlTools(): ToolStatus[] {
    return detectSourceControlTools();
  }

  /** Read a catalog skill's SKILL.md. Undefined when it could not be fetched. */
  async fetchSkillDetail(id: string): Promise<string | undefined> {
    return this.skillsClient.readSkillDoc(id);
  }

  listSessions(projectId?: string): Session[] {
    return this.repos.listSessions(projectId);
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const project = this.requireProject(input.projectId);
    const agentId = input.agentId ?? project.defaultAgentId ?? agentIdForMode(input.mode ?? project.defaultMode);
    const requestedWorkspaceMode =
      input.workspaceMode ?? project.defaultWorkspaceMode ?? this.settings.defaultWorkspaceMode;
    const workspaceMode =
      !isInboxProject(project) &&
      requestedWorkspaceMode === "worktree" &&
      readGitStatus(project.workingDirectory).isRepo
        ? "worktree"
        : "local";
    const session = createSessionRecord(project, { ...input, workspaceMode }, agentId);
    session.permissionProfile = input.permissionProfile ?? this.settings.defaultPermission;
    if (isInboxProject(project) && !session.workingDirectory) {
      session.workingDirectory = allocateThreadFolder(
        ensureProjectlessFolder(this.projectlessRoot()),
        session.title,
      );
    }
    if (session.workspaceMode === "worktree") {
      this.attachSessionWorktree(session, project);
    }
    if (!this.usingMock) {
      try {
        const remote = await this.openclaw.createSession({
          ...input,
          projectId: project.id,
          agentId,
          workingDirectory: session.workingDirectory ?? project.workingDirectory,
        });
        session.openclawSessionKey = remote.openclawSessionKey;
      } catch (error) {
        this.log(`OpenClaw session create failed: ${String(error)}`);
      }
    }
    this.repos.insertSession(session);
    // After the record exists: an action resolves its working directory
    // through the session, which cannot be read before it is stored.
    if (session.workspaceMode === "worktree") this.runWorktreeSetupActions(session, project);
    return session;
  }

  renameSession(id: string, title: string): Session {
    const session = this.requireSession(id);
    session.title = title.trim() || session.title;
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    return session;
  }

  archiveSession(id: string): Session {
    const session = this.requireSession(id);
    session.state = "archived";
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    return session;
  }

  deleteSession(id: string): void {
    const session = this.requireSession(id);
    const project = this.requireProject(session.projectId);
    for (const run of this.listProjectActionRuns(project.id, id)) {
      if (run.status === "running") this.stopProjectAction(project.id, run.actionId, id);
    }
    this.cleanupSessionWorktree(session, project);
    this.repos.deleteSession(id);
  }

  setSessionWorkspaceMode(id: string, mode: WorkspaceMode): Session {
    const session = this.requireSession(id);
    const project = this.requireProject(session.projectId);
    if (isInboxProject(project)) throw new Error("Inbox conversations already use isolated folders.");
    if (session.workspaceMode === mode) return session;
    if (
      this.repos.listMessages(id).length > 0 ||
      this.repos.listRuns(id).length > 0 ||
      isLiveHarnessState(session.harnessState)
    ) {
      throw new Error("Workspace mode can only change before the conversation starts.");
    }
    if (mode === "worktree") {
      session.workspaceMode = "worktree";
      this.attachSessionWorktree(session, project);
      this.runWorktreeSetupActions(session, project);
    } else {
      const cleanup = this.cleanupSessionWorktree(session, project);
      if (!cleanup) throw new Error("The worktree has changes and cannot be switched to Local.");
      session.workspaceMode = "local";
      session.workingDirectory = undefined;
      session.worktreeBranch = undefined;
    }
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    this.events.emit("state", { command: "sessions-updated" });
    return session;
  }

  pinSession(id: string, pinned: boolean): Session {
    const session = this.requireSession(id);
    session.pinned = pinned;
    if (pinned) {
      const pinnedSessions = this.repos
        .listSessions(session.projectId)
        .filter((item) => item.pinned && item.id !== id);
      session.pinOrder = pinnedSessions.reduce((max, item) => Math.max(max, item.pinOrder ?? -1), -1) + 1;
    } else {
      session.pinOrder = undefined;
    }
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    return session;
  }

  reorderPinnedSessions(projectId: string, orderedIds: string[]): Session[] {
    const pinned = this.repos.listSessions(projectId).filter((session) => session.pinned);
    const expected = new Set(pinned.map((session) => session.id));
    if (orderedIds.length !== expected.size || orderedIds.some((id) => !expected.has(id))) {
      throw new Error("Pinned conversation order is stale. Refresh and try again.");
    }
    orderedIds.forEach((id, pinOrder) => {
      const session = pinned.find((item) => item.id === id);
      if (!session) return;
      session.pinOrder = pinOrder;
      session.updatedAt = nowIso();
      this.repos.updateSession(session);
    });
    return this.repos.listSessions(projectId).filter((session) => session.pinned);
  }

  validateAttachments(
    attachments: ReadonlyArray<Pick<MessageAttachment, "name" | "path">>,
  ): MessageAttachment[] {
    return validateMessageAttachments(attachments);
  }

  regenerateTitle(id: string): Session {
    const session = this.requireSession(id);
    const first = this.repos.listMessages(id).find((message) => message.role === "user");
    session.title = titleFromPrompt(first?.content ?? session.title);
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    return session;
  }

  async setPermissionProfile(sessionId: string, profile: HarnessPermissionProfile): Promise<Session> {
    const session = this.requireSession(sessionId);
    session.permissionProfile = profile;
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    if (!this.usingMock && session.openclawSessionKey && isLiveHarnessState(session.harnessState)) {
      await this.openclaw.ensureAcpxPermissionMode(acpxPermissionMode(profile)).catch(() => undefined);
      await this.acpHost(session.openclawSessionKey).setAcpOption(
        session.openclawSessionKey,
        "permissions",
        profile,
      );
    }
    return session;
  }

  listMessages(sessionId: string): ChatMessage[] {
    return this.repos.listMessages(sessionId);
  }

  /**
   * One page of a conversation, newest page first. Fetching limit+1 tells us
   * whether an older page exists without a second COUNT over the table.
   */
  listMessagePage(
    sessionId: string,
    options?: { limit?: number; before?: { createdAt: string; id: string } },
  ): MessagePage {
    const limit = Math.min(Math.max(options?.limit ?? 60, 1), 500);
    const rows = this.repos.listMessagesBefore(sessionId, limit + 1, options?.before);
    const hasMore = rows.length > limit;
    // The extra row is the oldest one; drop it from the front.
    return { messages: hasMore ? rows.slice(1) : rows, hasMore };
  }

  async sendMessage(input: AgentMessage): Promise<{ session: Session; run: Run; userMessage: ChatMessage }> {
    let session = this.requireSession(input.sessionId);
    const project = this.requireProject(session.projectId);
    const attachments = validateMessageAttachments(input.attachments ?? []);
    if (!input.content.trim() && attachments.length === 0) {
      throw new Error("Write a message or attach a file first.");
    }
    const prompt = input.content.trim() || `Review the attached file${attachments.length === 1 ? "" : "s"}.`;
    const runtimePrompt = `${prompt}${attachmentPromptBlock(attachments)}`;
    const mode = input.mode ?? session.mode;
    const harnessId = this.resolveHarnessId(session, project, input.agentId, mode);
    if (harnessId) {
      session = await this.ensureHarnessSession(session, harnessId);
      if (!this.usingMock && !isAcpSessionKey(session.openclawSessionKey)) {
        throw new Error(
          `${harnessId} did not start through acpx. Capsule will not send this to OpenClaw's default agent (that path needs that agent's provider auth, not ${harnessId}).`,
        );
      }
    }
    const agentId = harnessId ?? input.agentId ?? session.agentId ?? agentIdForMode(mode);
    const skillId = input.skillId ?? skillIdForMode(mode);
    if (session.title === "New conversation") {
      session.title = titleFromPrompt(input.content.trim() || attachments[0]?.name || "New conversation");
    }
    session.agentId = agentId;
    session.mode = mode;
    session.updatedAt = nowIso();
    this.repos.updateSession(session);

    const userMessage: ChatMessage = {
      id: createId("msg"),
      sessionId: session.id,
      role: "user",
      content: input.content,
      attachments: attachments.length > 0 ? attachments : undefined,
      createdAt: nowIso(),
    };
    this.repos.insertMessage(userMessage);
    this.events.emit("message", userMessage);

    const run = createRunRecord({
      sessionId: session.id,
      projectId: project.id,
      agentId,
      skillId,
      prompt,
    });
    run.status = "running";
    this.repos.insertRun(run);

    const contract = buildContract({
      mode,
      prompt: runtimePrompt,
      workingDirectory: this.cwdFor(session, project),
      runId: run.id,
      outputDetail: this.settings.outputDetail,
      webAccess: this.settings.webAccess,
      sandbox: this.settings.sandbox,
    });
    this.repos.insertContract(contract);
    run.contractId = contract.id;
    this.repos.updateRun(run);

    this.appendEvent(run.id, "request", "Request received", { step: "understand" });
    this.appendEvent(run.id, "route", `Agent selected: ${agentId}`, { step: "route", agentId });
    this.appendEvent(run.id, "skill", skillId ? `Skill activated: ${skillId}` : "No skill override", {
      step: "skill",
      skillId,
    });
    this.appendEvent(run.id, "contract", "Contract created", {
      step: "contract",
      summary: contract.humanSummary,
    });

    const writeRule = decidePolicy(this.repos.listPolicies(), "filesystem", "write");
    this.repos.insertPolicyDecision(
      recordDecision(run.id, writeRule, project.workingDirectory ?? "(workspace)", "Default project write policy"),
    );

    if (this.usingMock) this.mock.setWorkspace(this.cwdFor(session, project));

    if (!this.usingMock && !harnessId) {
      session.openclawSessionKey = await this.openclaw.ensureOperatorSession({
        sessionKey: session.openclawSessionKey,
        label: gatewaySessionLabel(session.title, session.id),
        requestedAgentId: agentId,
      });
      this.repos.updateSession(session);
    }

    let skillInstruction = "";
    if (skillId) {
      const activeSkill =
        this.repos.getSkill(skillId) ??
        DEFAULT_SKILLS.find((skill) => skill.id === skillId) ??
        discoverGlobalSkills().find((skill) => skill.id === skillId);
      if (activeSkill?.content) {
        skillInstruction = `\n\n[Active Skill: ${activeSkill.name}]\n${activeSkill.content}`;
      }
    }

    const runtimeMessage: AgentMessage = {
      ...input,
      // Carried per turn so a session spawned before the profile changed still
      // gets the right mode applied.
      ...(session.permissionProfile
        ? { permissionProfile: session.permissionProfile as HarnessPermissionProfile }
        : {}),
      content: applyAgentInstructionHints(runtimePrompt + skillInstruction, this.settings),
      attachments,
      sessionId: this.usingMock ? session.id : (session.openclawSessionKey ?? session.id),
      agentId: this.usingMock ? agentId : undefined,
      skillId,
      mode,
    };

    /*
     * Direct mode carries its own turn. There is no Gateway run to subscribe
     * to: the CLI answers over its own stdout, `handleAcpReply` records what it
     * said, and the turn is finished here with the same lifecycle event the
     * Gateway route would have produced — so verification, the checkpoint and
     * the harness state all follow the one path.
     */
    if (isDirectSessionKey(session.openclawSessionKey)) {
      const key = session.openclawSessionKey!;
      void this.direct
        .send(key, runtimeMessage.content)
        .then(() =>
          this.handleRuntimeEvent(
            session,
            run,
            {
              id: createId("evt"),
              runId: run.id,
              timestamp: nowIso(),
              type: "run.completed",
              message: "",
              data: { status: "completed" },
            },
            () => undefined,
          ),
        )
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          return this.handleRuntimeEvent(
            session,
            run,
            {
              id: createId("evt"),
              runId: run.id,
              timestamp: nowIso(),
              type: "run.failed",
              message: detail,
              data: { status: "failed", error: detail },
            },
            () => undefined,
          );
        });
      this.events.emit("run", run);
      return { session, run, userMessage };
    }

    let runtimeRun: Run;
    try {
      runtimeRun = await this.runtime.sendMessage(runtimeMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run.status = "failed";
      run.error = message;
      run.updatedAt = nowIso();
      run.completedAt = nowIso();
      this.repos.updateRun(run);
      this.appendEvent(run.id, "lifecycle", message, { status: "failed", error: message });
      this.events.emit("run", run);
      throw new Error(message);
    }
    run.openclawRunId = runtimeRun.openclawRunId ?? runtimeRun.id;
    this.repos.updateRun(run);

    const stop = this.runtime.subscribeToRun(runtimeRun.id, (event) => {
      void this.handleRuntimeEvent(session, run, event, stop);
    });
    this.events.emit("run", run);
    return { session, run, userMessage };
  }

  async stopRun(runId: string): Promise<Run> {
    const run = this.requireRun(runId);
    await this.runtime.cancelRun(run.openclawRunId ?? run.id);
    run.status = "cancelled";
    run.updatedAt = nowIso();
    run.completedAt = nowIso();
    this.repos.updateRun(run);
    this.appendEvent(run.id, "cancelled", "Run cancelled");
    return run;
  }

  getRun(id: string): Run | undefined {
    return this.repos.getRun(id);
  }

  listRuns(sessionId?: string): Run[] {
    return this.repos.listRuns(sessionId);
  }

  listRunEvents(runId: string): RunEvent[] {
    return this.repos.listRunEvents(runId);
  }

  async verifyRun(runId: string) {
    const run = this.requireRun(runId);
    const contract = run.contractId ? this.repos.getContract(run.contractId) : undefined;
    if (!contract) throw new Error("Run has no contract");
    return verifyContract({
      contract,
      output: run.result ?? "",
      workingDirectory: this.getProject(run.projectId)?.workingDirectory,
    });
  }

  listArtifacts(runId?: string) {
    return this.repos.listArtifacts(runId);
  }

  listApprovals(status?: ApprovalRequest["status"]) {
    return this.repos.listApprovals(status);
  }

  async resolveApproval(
    approvalId: string,
    decision: "approved_once" | "approved_session" | "denied",
  ): Promise<void> {
    const approvals = this.repos.listApprovals("pending");
    const approval = approvals.find((item) => item.id === approvalId);
    if (!approval) throw new Error("Approval not found");
    approval.status = decision;
    approval.resolvedAt = nowIso();
    this.repos.updateApproval(approval);
    await this.runtime.resolveApproval?.(approvalId, decision);
    this.events.emit("approval", approval);
  }

  listFiles(projectId: string, relative = ".", root?: string) {
    const project = this.requireProject(projectId);
    const decision = decidePolicy(this.repos.listPolicies(), "filesystem", "read");
    if (decision.decision === "block") throw new Error("Filesystem read is blocked by policy");
    return new FilesystemAdapter(this.resolveProjectFolder(project, root)).list(relative);
  }

  previewFile(projectId: string, relative: string, root?: string): FilePreview {
    const project = this.requireProject(projectId);
    const decision = decidePolicy(this.repos.listPolicies(), "filesystem", "read");
    if (decision.decision === "block") throw new Error("Filesystem read is blocked by policy");
    return new FilesystemAdapter(this.resolveProjectFolder(project, root)).preview(relative);
  }

  searchFiles(projectId: string, query = "", root?: string): FileEntry[] {
    const project = this.requireProject(projectId);
    const folder = this.resolveProjectFolder(project, root);
    return new FilesystemAdapter(folder).search(query);
  }

  readFile(projectId: string, relative: string, root?: string): string {
    const project = this.requireProject(projectId);
    const decision = decidePolicy(this.repos.listPolicies(), "filesystem", "read");
    if (decision.decision === "block") throw new Error("Filesystem read is blocked by policy");
    return new FilesystemAdapter(this.resolveProjectFolder(project, root)).read(relative);
  }

  /*
   * The filesystem write policy defaults to "approval", and this used to throw
   * on that — which made every write unreachable rather than asking anyone.
   * The policy is there to gate the *agent*: a person editing a file in
   * Capsule's own editor has already consented by typing and saving it, so a
   * user-originated write satisfies the approval requirement. "block" still
   * blocks both, and an agent write on "approval" still refuses, because
   * nothing has actually asked the user yet.
   */
  /**
   * Read for editing: the revision is the token the editor sends back on save,
   * so a write can tell "nothing else touched this" from "the agent rewrote it
   * while you were typing".
   */
  readFileVersioned(
    projectId: string,
    relative: string,
    previewLimit = 8_000,
    root?: string,
  ): FileReadResult {
    const contents = this.readFile(projectId, relative, root);
    return {
      // The revision always describes the file on disk, never the truncated
      // prefix — otherwise a reload would look like an external change.
      revision: fileContentRevision(contents),
      truncated: contents.length > previewLimit,
      contents: contents.slice(0, previewLimit),
    };
  }

  writeFile(
    projectId: string,
    relative: string,
    content: string,
    options?: { origin?: "user" | "agent"; expectedRevision?: string; root?: string },
  ): { revision: string } {
    const project = this.requireProject(projectId);
    const origin = options?.origin ?? "agent";
    const decision = decidePolicy(this.repos.listPolicies(), "filesystem", "write");
    if (decision.decision === "block") throw new Error("Filesystem write is blocked by policy");
    if (decision.decision === "approval" && origin !== "user") {
      throw new Error("Filesystem write requires approval");
    }
    const adapter = new FilesystemAdapter(this.resolveProjectFolder(project, options?.root));
    /*
     * Optimistic concurrency. The editor sends the revision it loaded; if the
     * bytes on disk no longer match it, something else — almost always the
     * agent writing over ACP — changed the file since. Refuse rather than
     * overwrite, and let the caller decide.
     */
    if (options?.expectedRevision !== undefined) {
      let current: string | undefined;
      try {
        current = adapter.read(relative);
      } catch {
        // A file that no longer reads (deleted, or newly created by this very
        // write) cannot be compared; fall through and write it.
        current = undefined;
      }
      if (current !== undefined && fileContentRevision(current) !== options.expectedRevision) {
        throw new Error(FILE_CHANGED_ON_DISK);
      }
    }
    adapter.write(relative, content);
    if (origin === "user") this.log(`Edited ${relative}`);
    // Hand back the new base revision so the caller can keep editing without
    // re-reading the file.
    return { revision: fileContentRevision(content) };
  }

  async openTerminal(projectId: string, sessionId?: string): Promise<void> {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd) throw new Error("Choose a project folder first");
    await openNativeTerminal(cwd);
  }

  async execInProject(projectId: string, command: string, sessionId?: string) {
    const project = this.requireProject(projectId);
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd) throw new Error("Choose a project folder first");
    if (this.settings.sandbox === "strict") {
      throw new Error("Strict sandbox blocks project terminal commands.");
    }
    return runInDirectory(cwd, command);
  }

  runProjectAction(projectId: string, actionId: string, sessionId?: string): ProjectActionRun {
    const project = this.requireProject(projectId);
    const action = project.actions?.find((candidate) => candidate.id === actionId);
    if (!action) throw new Error("Project action not found.");
    if (this.settings.sandbox === "strict") {
      throw new Error("Strict sandbox blocks project actions.");
    }
    const cwd = this.workingDirectoryFor(project, sessionId);
    if (!cwd) throw new Error("Choose a project folder first");
    const key = this.projectActionKey(projectId, actionId, sessionId);
    const existing = this.actionRuns.get(key);
    if (existing?.status === "running") return existing;
    const run: ProjectActionRun = {
      projectId,
      actionId,
      ...(sessionId ? { sessionId } : {}),
      status: "running",
      output: "",
      startedAt: nowIso(),
    };
    this.actionRuns.set(key, run);
    const process = startInDirectory(cwd, action.command, {
      onOutput: (text) => {
        run.output = `${run.output}${text}`.slice(-20_000);
        this.events.emit("state", { command: "project-actions-updated" });
      },
      onError: (error) => {
        run.status = "failed";
        run.output = `${run.output}\n${error.message}`.trim().slice(-20_000);
        run.completedAt = nowIso();
        this.actionProcesses.delete(key);
        this.events.emit("state", { command: "project-actions-updated" });
      },
      onExit: (code, signal) => {
        if (run.status === "running") run.status = code === 0 ? "completed" : "failed";
        if (code !== null) run.output = `${run.output}\nexit ${code}`.trim().slice(-20_000);
        else if (signal) run.output = `${run.output}\n${signal}`.trim().slice(-20_000);
        run.completedAt = nowIso();
        this.actionProcesses.delete(key);
        this.events.emit("state", { command: "project-actions-updated" });
      },
    });
    run.pid = process.pid;
    this.actionProcesses.set(key, process);
    this.log(`Started project action ${action.name} in ${cwd}`);
    return run;
  }

  stopProjectAction(projectId: string, actionId: string, sessionId?: string): ProjectActionRun {
    const key = this.projectActionKey(projectId, actionId, sessionId);
    const run = this.actionRuns.get(key);
    if (!run) throw new Error("Project action is not running.");
    run.status = "stopped";
    run.completedAt = nowIso();
    this.actionProcesses.get(key)?.stop();
    this.actionProcesses.delete(key);
    this.events.emit("state", { command: "project-actions-updated" });
    return run;
  }

  listProjectActionRuns(projectId: string, sessionId?: string): ProjectActionRun[] {
    return [...this.actionRuns.values()].filter(
      (run) => run.projectId === projectId && (!sessionId || run.sessionId === sessionId),
    );
  }

  getSettings(): CapsuleSettings {
    return {
      ...this.settings,
      gatewayToken: this.settings.gatewayToken ? TOKEN_PRESENT_MASK : undefined,
      skillsShToken: this.settings.skillsShToken ? TOKEN_PRESENT_MASK : undefined,
    };
  }

  /**
   * Reset one section's settings to their defaults.
   *
   * Scoped rather than wholesale: someone restoring Appearance has not asked to
   * lose their gateway URL. Optional keys are deleted rather than written, so a
   * setting with no default (a custom font, a branch prefix) goes back to
   * absent instead of to an empty string that later reads as "set to nothing".
   * Secrets are not in any section's list and are never touched here.
   */
  async resetSettingsSection(section: string): Promise<CapsuleSettings> {
    const keys = SETTINGS_SECTION_KEYS[section];
    if (!keys || keys.length === 0) return this.getSettings();

    const next: Record<string, unknown> = { ...this.settings };
    for (const key of keys) {
      const fallback = (DEFAULT_CAPSULE_SETTINGS as unknown as Record<string, unknown>)[key];
      if (fallback === undefined) delete next[key];
      else next[key] = fallback;
    }
    this.settings = normalizeCapsuleSettings(next as Partial<CapsuleSettings>);
    this.persistSettings();
    this.events.emit("state", { command: "settings-updated" });
    return this.getSettings();
  }

  async updateSettings(patch: Partial<CapsuleSettings>): Promise<CapsuleSettings> {
    const { gatewayToken, skillsShToken, ...rest } = patch;
    this.settings = normalizeCapsuleSettings({ ...this.settings, ...rest });
    if (gatewayToken === TOKEN_PRESENT_MASK) {
      // Renderer round-trip of a stored token — keep the secret in Keychain.
    } else if (gatewayToken === "") {
      delete this.settings.gatewayToken;
      await this.keychain.delete(CAPSULE_KEYCHAIN_SERVICE, GATEWAY_TOKEN_ACCOUNT);
    } else if (typeof gatewayToken === "string") {
      this.settings.gatewayToken = gatewayToken;
      await this.keychain.set(CAPSULE_KEYCHAIN_SERVICE, GATEWAY_TOKEN_ACCOUNT, gatewayToken);
    }
    if (skillsShToken === TOKEN_PRESENT_MASK) {
      // Renderer round-trip of the stored token — leave the secret alone.
    } else if (skillsShToken === "") {
      delete this.settings.skillsShToken;
      this.skillsShClient.setToken(undefined);
      await this.keychain.delete(CAPSULE_KEYCHAIN_SERVICE, SKILLS_SH_TOKEN_ACCOUNT);
    } else if (typeof skillsShToken === "string") {
      this.settings.skillsShToken = skillsShToken;
      this.skillsShClient.setToken(skillsShToken);
      await this.keychain.set(CAPSULE_KEYCHAIN_SERVICE, SKILLS_SH_TOKEN_ACCOUNT, skillsShToken);
    }
    if (patch.projectlessFolder !== undefined) this.bindInboxToProjectless();
    if (
      patch.webAccess !== undefined ||
      patch.sandbox !== undefined ||
      patch.defaultPermission !== undefined
    ) {
      this.applyWorkspacePolicies();
    }
    if (patch.archiveInactiveAfter !== undefined) this.archiveInactiveSessions();
    if (!pullRequestWatchEnabled(this.settings)) this.stopAllPrWatch();
    this.persistSettings();
    return this.getSettings();
  }

  getDiagnostics(): DiagnosticsSnapshot {
    return {
      capsuleVersion: this.options.capsuleVersion ?? "0.1.0",
      electronVersion: process.versions.electron,
      macosVersion:
        process.platform === "darwin"
          ? (process as NodeJS.Process & { getSystemVersion?: () => string }).getSystemVersion?.()
          : undefined,
      gatewayStatus: this.usingMock ? "disconnected" : "connected",
      databaseStatus: "connected",
      connectionLogs: [...this.logs].slice(-200),
    };
  }

  search(query: string): SearchResults {
    const needle = query.trim().toLowerCase();
    if (!needle) return { projects: [], sessions: [], runs: [], messages: [] };
    return {
      projects: this.listProjects().filter((project) => project.name.toLowerCase().includes(needle)),
      sessions: this.listSessions().filter((session) => session.title.toLowerCase().includes(needle)),
      runs: this.listRuns().filter((run) => run.prompt.toLowerCase().includes(needle)),
      messages: this.repos.searchMessages(needle),
    };
  }

  private bindAcpReplies(): void {
    this.acpUnsub?.();
    if (this.usingMock) return;
    this.acpUnsub = this.openclaw.onAcpReply((payload) => this.handleAcpReply(payload));
    // Both routes deliver the same reply shape, and a thread keeps whichever
    // one started it, so both stay bound regardless of the current setting.
    this.directUnsub?.();
    this.directUnsub = this.direct.onAcpReply((payload: AcpReply) => this.handleAcpReply(payload));
  }

  private handleAcpReply(payload: {
    sessionKey?: string;
    text?: string;
    done?: boolean;
    control?: boolean;
  }): void {
    if (!payload.sessionKey) return;
    if (payload.control) return;
    // Behind the control marking: a status dump is recognisable on its own, so
    // a frame that slips past the marking still cannot become a message.
    if (isAcpControlOutput(payload.text)) return;
    const session = this.repos
      .listSessions()
      .find((item) => item.openclawSessionKey === payload.sessionKey);
    if (!session) return;
    if (payload.text) {
      const prev = this.acpBuffers.get(payload.sessionKey) ?? "";
      this.acpBuffers.set(payload.sessionKey, `${prev}${payload.text}`);
    }
    if (!payload.done) return;
    const content = (this.acpBuffers.get(payload.sessionKey) ?? payload.text ?? "").trim();
    this.acpBuffers.delete(payload.sessionKey);
    if (content.length < 2) return;
    const last = this.repos.listMessages(session.id).at(-1);
    if (last?.role === "assistant" && last.content === content) return;
    /*
     * The reply belongs to the turn that asked for it. Nothing linked them, so
     * the run finished with no result — and the contract's only decisive check
     * is that the run produced output, which meant every completed ACP turn
     * was marked "Verification failed" and every answered conversation showed
     * as failed in the sidebar.
     */
    const active = this.repos
      .listRuns(session.id)
      .find((run) => ["running", "waiting", "queued"].includes(run.status));
    const message: ChatMessage = {
      id: createId("msg"),
      sessionId: session.id,
      role: "assistant",
      content,
      ...(active ? { runId: active.id } : {}),
      createdAt: nowIso(),
    };
    this.repos.insertMessage(message);
    this.events.emit("message", message);
    if (active) {
      active.result = active.result ? `${active.result}\n${content}` : content;
      active.updatedAt = nowIso();
      this.repos.updateRun(active);
    }
    const failed = acpCommandFailed(content);
    if (!failed) return;
    const running = this.repos
      .listRuns(session.id)
      .find((run) => ["running", "waiting"].includes(run.status));
    if (!running) return;
    running.status = "failed";
    running.error = failed;
    running.result = content;
    running.updatedAt = nowIso();
    running.completedAt = nowIso();
    this.repos.updateRun(running);
    this.appendEvent(running.id, "lifecycle", failed, {
      status: "failed",
      error: failed,
    });
    this.events.emit("run", running);
  }

  /*
   * The mock runtime is a test double, reached only by constructing the engine
   * with autoConnect: false. It used to be what the app fell back to whenever
   * the Gateway was unreachable, which meant an offline Capsule answered with
   * invented replies that looked exactly like real ones.
   */
  /**
   * The host that owns a thread's ACP session.
   *
   * A thread keeps the route it started on: its session key says which, so a
   * setting changed mid-conversation cannot steer a turn into a host that has
   * never heard of that session.
   */
  private acpHost(sessionKey: string | undefined): DirectAcpHost | OpenClawAdapter {
    return isDirectSessionKey(sessionKey) ? this.direct : this.openclaw;
  }

  /** Whether this turn should be carried by the CLI directly. */
  private useDirectMode(harnessId?: HarnessId): boolean {
    if (this.usingMock) return false;
    const mode = this.settings.runtimeMode;
    if (mode === "openclaw") return false;
    // Direct mode can only drive an agent that speaks ACP itself.
    if (harnessId && !supportsDirectMode(harnessId)) return false;
    if (mode === "direct") return true;
    // auto: the Gateway when there is one, this Mac when there is not.
    return this.runtime.kind !== "openclaw";
  }

  private async connectPreferredRuntime(): Promise<void> {
    // A new connection may be a different Gateway with different plugins.
    this.forgetAcpxState();
    if (this.options.autoConnect === false) {
      await this.mock.connect();
      this.runtime = this.mock;
      await this.syncRuntimeCatalog();
      return;
    }
    try {
      await this.connectGateway();
    } catch (error) {
      // Offline is a state, not a failure to start: the app opens, says so,
      // and offers to connect.
      this.log(`Gateway unavailable, staying offline: ${String(error)}`);
    }
  }

  private async syncRuntimeCatalog(): Promise<void> {
    const agents = await this.runtime.listAgents().catch(() => [] as Agent[]);
    // Do not relabel mock fallbacks as live OpenClaw agents when the Gateway
    // cannot list its configured agents. They must remain unavailable until
    // the Gateway reports a real, configured target.
    const availableAgents = agents.length > 0 ? agents : this.usingMock ? DEFAULT_AGENTS : [];
    for (const agent of availableAgents) {
      this.repos.upsertAgent({
        ...agent,
        runtime: this.usingMock ? "mock" : "openclaw",
      });
    }
    const skills = await this.runtime.listSkills().catch(() => DEFAULT_SKILLS);
    for (const skill of skills.length > 0 ? skills : DEFAULT_SKILLS) {
      this.repos.upsertSkill(skill);
    }
    if (this.repos.listPolicies().length === 0) {
      for (const rule of DEFAULT_POLICIES) this.repos.insertPolicy(rule);
    }
  }

  private async handleRuntimeEvent(
    session: Session,
    run: Run,
    event: RunEvent,
    stop: () => void,
  ): Promise<void> {
    if (this.stopped) {
      stop();
      return;
    }
    const mapped: RunEvent = {
      ...event,
      runId: run.id,
      id: event.id || createId("evt"),
    };
    this.repos.insertRunEvent(mapped);
    this.events.emit("run-event", mapped);

    if (event.type === "approval.requested" && event.data?.approval) {
      const approval = event.data.approval as ApprovalRequest;
      this.repos.insertApproval({ ...approval, runId: run.id });
      run.status = "approval_required";
      run.updatedAt = nowIso();
      this.repos.updateRun(run);
      this.events.emit("approval", approval);
      this.events.emit("run", run);
      return;
    }

    if (event.type === "assistant" && event.message) {
      run.result = `${run.result ?? ""}${event.message}`;
      this.repos.updateRun(run);
    }

    const status = event.data?.status;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      stop();
      run.status = status;
      run.updatedAt = nowIso();
      run.completedAt = nowIso();
      if (typeof event.data?.output === "string") run.result = event.data.output;
      if (typeof event.data?.error === "string") run.error = event.data.error;
      this.captureTurnCheckpoint(run, session);
      /*
       * A finished turn leaves the ACP session alive but idle. Nothing used to
       * write the session out of "running", so the sidebar kept showing
       * "Working" for threads whose last run had completed hours earlier.
       * "waiting" keeps the harness live without claiming work is in flight.
       */
      if (isLiveHarnessState(session.harnessState) && session.harnessState !== "waiting") {
        session.harnessState = "waiting";
        session.updatedAt = nowIso();
        this.repos.updateSession(session);
        this.events.emit("state", { command: "harness-updated" });
      }
      if (status === "completed") {
        if (this.usingMock) {
          if (run.result) {
            const assistantMessage: ChatMessage = {
              id: createId("msg"),
              sessionId: session.id,
              role: "assistant",
              content: run.result,
              runId: run.id,
              createdAt: nowIso(),
            };
            this.repos.insertMessage(assistantMessage);
            this.events.emit("message", assistantMessage);
          }
          this.repos.updateRun(run);
          this.events.emit("run", run);
          return;
        }
        /*
         * Only a run that actually finished can be judged against its
         * contract. A failed or cancelled run has no output to verify, so
         * verifying it produced a "Verification failed" artifact and — worse —
         * overwrote the real cause (an ACP "Authentication required", a
         * cancellation) with a generic contract verdict. The run already
         * carries its own status and error.
         */
        const contract =
          status === "completed" && run.contractId
            ? this.repos.getContract(run.contractId)
            : undefined;
        /*
         * A last resort for a turn whose text arrived by another route: judge
         * it on what the conversation actually gained, not on a field nothing
         * filled in.
         */
        if (contract && !run.result?.trim()) {
          const since = Date.parse(run.createdAt);
          run.result = this.repos
            .listMessages(session.id)
            .filter(
              (item) =>
                item.role === "assistant" &&
                (item.runId === run.id || Date.parse(item.createdAt) >= since),
            )
            .map((item) => item.content)
            .join("\n")
            .trim();
        }
        if (contract) {
          const verification = verifyContract({
            contract,
            output: run.result ?? "",
            workingDirectory: this.getProject(run.projectId)?.workingDirectory,
            forceFail: Boolean(event.data?.forceVerifyFail),
          });
          if (!verification.passed) {
            run.status = "failed";
            /*
             * Which check failed, not that checking happened. "Verification
             * failed" is Capsule talking to itself; the check's own detail
             * says what the turn was supposed to have produced.
             */
            const failed = verification.checks.find((check) => !check.advisory && !check.passed);
            run.error = failed?.detail || failed?.description || verification.summary;
          }
          this.appendEvent(run.id, "verification", verification.summary, {
            passed: verification.passed,
          });
        }
        if (run.result && isAcpControlOutput(run.result)) {
          // The turn's own answer never looks like this; a control command's
          // does, and it is not something the reader asked for.
          run.result = undefined;
        }
        if (run.result) {
          const last = this.repos.listMessages(session.id).at(-1);
          if (!(last?.role === "assistant" && last.content === run.result)) {
            const assistantMessage: ChatMessage = {
              id: createId("msg"),
              sessionId: session.id,
              role: "assistant",
              content: run.result,
              runId: run.id,
              createdAt: nowIso(),
            };
            this.repos.insertMessage(assistantMessage);
            this.events.emit("message", assistantMessage);
          }
        }
      }
      this.repos.updateRun(run);
      this.events.emit("run", run);
    }
  }

  private appendEvent(
    runId: string,
    type: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const event = createRunEvent(runId, type, message, data);
    this.repos.insertRunEvent(event);
    this.events.emit("run-event", event);
  }

  private projectlessRoot(): string {
    if (this.settings.projectlessFolder?.trim()) return this.settings.projectlessFolder.trim();
    if (process.env.VITEST) return path.join(this.options.userDataDir, "tasks");
    return defaultProjectlessFolder();
  }

  private cwdFor(session: Session, project: Project): string | undefined {
    return session.workingDirectory || project.workingDirectory;
  }

  private bindInboxToProjectless(): void {
    const root = ensureProjectlessFolder(this.projectlessRoot());
    const inbox = this.repos.listProjects().find((project) => isInboxProject(project));
    if (!inbox) {
      this.createProject({
        name: INBOX_PROJECT_NAME,
        description: "Tasks started outside a project.",
        workingDirectory: root,
      });
      return;
    }
    if (inbox.workingDirectory === root) return;
    inbox.workingDirectory = root;
    inbox.description = inbox.description || "Tasks started outside a project.";
    inbox.updatedAt = nowIso();
    this.repos.updateProject(inbox);
  }

  /*
   * A run that was in flight when the app quit is cancelled, not failed. It
   * was marked failed, which painted the conversation red in the sidebar for
   * ever after — including threads whose answer had already arrived and whose
   * only problem was that Capsule was closed afterwards.
   */
  private failStaleRuns(): void {
    for (const run of this.repos.listRuns()) {
      if (!["running", "waiting", "queued"].includes(run.status)) continue;
      run.status = "cancelled";
      run.error = run.error ?? "Interrupted when Capsule last quit.";
      run.updatedAt = nowIso();
      run.completedAt = nowIso();
      this.repos.updateRun(run);
    }
    /*
     * And the sessions that were pointing at those runs. An ACP session does
     * not survive the app quitting, but its "running" state was written to the
     * database — so every thread that had ever been live came back claiming to
     * be Working, with a harness bar offering to cancel a turn that ended when
     * the app closed.
     */
    for (const session of this.repos.listSessions()) {
      if (!isLiveHarnessState(session.harnessState)) continue;
      session.harnessState = "closed";
      session.openclawSessionKey = undefined;
      session.updatedAt = nowIso();
      this.repos.updateSession(session);
    }
  }

  private bootstrapWorkspace(): void {
    const existing = this.repos.listWorkspaces()[0];
    if (existing) {
      this.workspaceId = existing.id;
      if (this.repos.listProjects().length === 0) {
        this.createProject({
          name: INBOX_PROJECT_NAME,
          description: "Tasks started outside a project.",
        });
      }
      if (this.repos.listSkillPacks().length === 0) {
        for (const pack of DEFAULT_SKILL_PACKS) this.repos.upsertSkillPack(pack);
        for (const skill of DEFAULT_SKILLS) this.repos.upsertSkill(skill);
      }
      return;
    }
    const timestamp = nowIso();
    this.workspaceId = createId("ws");
    this.repos.insertWorkspace({
      id: this.workspaceId,
      name: "Local",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.createProject({
      name: INBOX_PROJECT_NAME,
      description: "Tasks started outside a project.",
    });
    for (const agent of DEFAULT_AGENTS) this.repos.upsertAgent(agent);
    for (const pack of DEFAULT_SKILL_PACKS) this.repos.upsertSkillPack(pack);
    for (const skill of DEFAULT_SKILLS) this.repos.upsertSkill(skill);
    for (const rule of DEFAULT_POLICIES) this.repos.insertPolicy(rule);
  }

  private loadSettings(): void {
    const raw = this.repos.getSetting("settings");
    if (!raw) return;
    try {
      this.settings = normalizeCapsuleSettings({
        ...this.settings,
        ...(JSON.parse(raw) as Partial<CapsuleSettings>),
      });
    } catch {
      // Keep defaults if persisted settings are unreadable.
    }
  }

  private schedulePrWatch(projectId: string, sessionId?: string): void {
    if (sessionId) this.prWatchSessions.set(projectId, sessionId);
    if (!pullRequestWatchEnabled(this.settings)) {
      this.stopPrWatch(projectId);
      return;
    }
    if (this.prWatchers.has(projectId)) return;
    const timer = setInterval(() => {
      void this.tickPrWatch(projectId);
    }, 45_000);
    this.prWatchers.set(projectId, timer);
    void this.tickPrWatch(projectId);
  }

  private stopPrWatch(projectId: string): void {
    const timer = this.prWatchers.get(projectId);
    if (timer) clearInterval(timer);
    this.prWatchers.delete(projectId);
  }

  private stopAllPrWatch(): void {
    for (const id of [...this.prWatchers.keys()]) this.stopPrWatch(id);
  }

  private async tickPrWatch(projectId: string): Promise<void> {
    if (this.stopped) {
      this.stopPrWatch(projectId);
      return;
    }
    const project = this.repos.getProject(projectId);
    if (!project?.workingDirectory) {
      this.stopPrWatch(projectId);
      return;
    }
    const pullRequest = viewPullRequest(project.workingDirectory);
    if (!pullRequest || pullRequest.state === "MERGED" || pullRequest.state === "CLOSED") {
      this.events.emit("state", { command: "git-updated" });
      if (!this.settings.prWatchUntilMerged || !pullRequest || pullRequest.state !== "OPEN") {
        this.stopPrWatch(projectId);
      }
      return;
    }
    if (this.settings.prWatchAndFix && pullRequest.checks === "failure") {
      const fingerprint = `${pullRequest.number}:${pullRequest.checksSummary ?? "failed"}`;
      if (this.prFixFingerprints.get(projectId) !== fingerprint) {
        const sent = await this.requestPrFix(projectId, pullRequest.url, pullRequest.number, pullRequest.checksSummary);
        if (sent) this.prFixFingerprints.set(projectId, fingerprint);
      }
    }
    if (
      this.settings.prAutoMerge &&
      pullRequest.checks !== "failure" &&
      pullRequest.checks !== "pending"
    ) {
      mergeGithubPullRequest(project.workingDirectory, this.settings.prMergeMethod, false);
    }
    this.events.emit("state", { command: "git-updated" });
  }

  private async requestPrFix(
    projectId: string,
    url: string,
    number: number,
    summary?: string,
  ): Promise<boolean> {
    let sessionId = this.prWatchSessions.get(projectId);
    if (!sessionId || this.settings.prReviewDelivery === "new-chat") {
      const session = await this.createSession({
        projectId,
        title: `PR #${number} checks`,
        mode: "code",
      });
      sessionId = session.id;
      this.prWatchSessions.set(projectId, sessionId);
    }
    const busy = this.listRuns(sessionId).some((run) =>
      ["running", "waiting", "approval_required"].includes(run.status),
    );
    if (busy) return false;
    const prompt = [
      `The pull request #${number} (${url}) failed checks${summary ? `: ${summary}` : "."}`,
      "",
      "Fix the failures in this repository, then push. Do not merge.",
    ].join("\n");
    await this.sendMessage({ sessionId, content: prompt, mode: "code" });
    this.events.emit("state", { command: "sessions-updated" });
    return true;
  }

  private persistSettings(): void {
    const stored = { ...this.settings };
    delete stored.gatewayToken;
    this.repos.setSetting("settings", JSON.stringify(stored));
  }

  private applyWorkspacePolicies(): void {
    for (const rule of policiesFromSettings({
      webAccess: this.settings.webAccess,
      sandbox: this.settings.sandbox,
    })) {
      this.repos.upsertPolicy(rule);
    }
  }

  private archiveInactiveSessions(): void {
    const cutoffMs = ARCHIVE_INACTIVE_MS[this.settings.archiveInactiveAfter];
    if (cutoffMs == null) return;
    const now = Date.now();
    const activeRunIds = new Set(
      this.repos
        .listRuns()
        .filter((run) => ["running", "waiting", "approval_required"].includes(run.status))
        .map((run) => run.sessionId),
    );
    let archived = 0;
    for (const session of this.repos.listSessions()) {
      if (
        !shouldArchiveInactiveSession({
          state: session.state,
          pinned: session.pinned,
          updatedAt: session.updatedAt,
          liveHarness: isLiveHarnessState(session.harnessState),
          hasActiveRun: activeRunIds.has(session.id),
          cutoffMs,
          now,
        })
      ) {
        continue;
      }
      session.state = "archived";
      session.updatedAt = nowIso();
      this.repos.updateSession(session);
      archived += 1;
    }
    if (archived > 0) {
      this.log(`Archived ${archived} inactive session${archived === 1 ? "" : "s"}`);
      this.events.emit("state", { command: "sessions-updated" });
    }
  }

  private createOpenClawAdapter(): OpenClawAdapter {
    return new OpenClawAdapter({
      gatewayUrl: this.settings.gatewayUrl,
      token: this.settings.gatewayToken,
      clientVersion: this.options.clientVersion,
      identityDir: path.join(this.options.userDataDir, "identity"),
    });
  }

  /**
   * Capture the worktree as this turn ends.
   *
   * The changed-files card diffs the working tree against HEAD, which mixes the
   * agent's edits with the user's own and cannot be scoped to a turn. Two
   * consecutive checkpoints bound exactly what one turn changed, and restoring
   * one puts the worktree back.
   *
   * Best effort by design: a repository-less project, or a git invocation that
   * fails, must not fail the turn that just succeeded.
   */
  private captureTurnCheckpoint(run: Run, session: Session): void {
    const cwd = session.workingDirectory ?? this.repos.getProject(session.projectId)?.workingDirectory;
    if (!cwd) return;
    const turn = this.repos.listRuns(session.id).length;
    const ref = checkpointRef(session.id, turn);
    /*
     * Off this tick. `git add -A` against a fresh index reads the whole
     * worktree — three seconds on a large repository — and it ran inline at
     * the end of every turn, freezing the window and every queued IPC call
     * for that long just as the answer arrived.
     */
    setImmediate(() => {
      if (this.stopped) return;
      try {
        const result = captureCheckpoint(cwd, ref);
        if (!result.ok) return;
        const stored = this.repos.getRun(run.id);
        if (!stored) return;
        stored.checkpointRef = ref;
        this.repos.updateRun(stored);
        this.events.emit("run", stored);
      } catch {
        // A checkpoint is a convenience; losing one is not worth a crash.
      }
    });
  }

  /**
   * Token accounting for the last `days` days, read from the CLIs' own
   * transcripts. Nothing is recorded for this; see usage/transcripts.
   */
  usageSummary(days: number): UsageSummary {
    return readUsageSummary(sinceDaysAgo(days));
  }

  /** The patch a single turn produced, from its checkpoint back to the previous one. */
  turnDiff(runId: string): { patch: string; files: Array<{ path: string; added: number; removed: number }> } {
    const run = this.repos.getRun(runId);
    if (!run?.checkpointRef) return { patch: "", files: [] };
    const session = this.repos.getSession(run.sessionId);
    const project = session ? this.repos.getProject(session.projectId) : undefined;
    const cwd = session?.workingDirectory ?? project?.workingDirectory;
    if (!cwd) return { patch: "", files: [] };
    const previous = this.repos
      .listRuns(run.sessionId)
      .filter((candidate) => candidate.checkpointRef && candidate.createdAt < run.createdAt)
      .at(-1)?.checkpointRef;
    return {
      patch: diffCheckpoints(cwd, run.checkpointRef, previous),
      files: checkpointNumstat(cwd, run.checkpointRef, previous),
    };
  }

  /** Put the worktree back to how a turn left it. */
  restoreTurn(runId: string): { ok: boolean; detail: string } {
    const run = this.repos.getRun(runId);
    if (!run?.checkpointRef) return { ok: false, detail: "That turn has no checkpoint." };
    const session = this.repos.getSession(run.sessionId);
    const project = session ? this.repos.getProject(session.projectId) : undefined;
    const cwd = session?.workingDirectory ?? project?.workingDirectory;
    if (!cwd) return { ok: false, detail: "That turn has no working directory." };
    const result = restoreCheckpoint(cwd, run.checkpointRef);
    if (result.ok) this.events.emit("state", { command: "files-updated" });
    return result;
  }

  private async hydrateSecrets(): Promise<void> {
    const token = await this.keychain.get(CAPSULE_KEYCHAIN_SERVICE, GATEWAY_TOKEN_ACCOUNT);
    if (token) this.settings.gatewayToken = token;
    if (process.env.OPENCLAW_GATEWAY_TOKEN) {
      this.settings.gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    }

    // skills.sh: the Keychain entry wins, then the ambient Vercel token that
    // `vercel env pull` leaves in the environment.
    const skillsToken =
      (await this.keychain.get(CAPSULE_KEYCHAIN_SERVICE, SKILLS_SH_TOKEN_ACCOUNT)) ||
      process.env.VERCEL_OIDC_TOKEN;
    if (skillsToken) {
      this.settings.skillsShToken = skillsToken;
      this.skillsShClient.setToken(skillsToken);
    }
  }

  private resolveHarnessId(
    session: Session,
    project: Project,
    requestedAgent: string | undefined,
    mode: AgentMode,
  ): HarnessId | undefined {
    if (isHarnessId(requestedAgent)) return requestedAgent;
    if (session.harnessId && isHarnessId(session.harnessId)) return session.harnessId;
    if (isHarnessId(session.agentId)) return session.agentId;
    if (mode === "code" && isHarnessId(project.defaultAgentId)) return project.defaultAgentId;
    return undefined;
  }

  private async ensureHarnessSession(session: Session, harnessId: HarnessId): Promise<Session> {
    const current = this.requireSession(session.id);
    const live = isLiveHarnessState(current.harnessState) && (this.usingMock || current.openclawSessionKey);
    if (live && current.harnessId === harnessId) {
      return current;
    }
    /*
     * Switching the agent on a live thread used to reuse whatever session was
     * already running: the prompt went to the old harness while the thread
     * relabelled itself as the new one, so the picker said Codex and Claude
     * answered. Close the old session before starting the new agent's.
     */
    if (live && current.harnessId && current.harnessId !== harnessId) {
      try {
        await this.closeHarness(current.id);
      } catch (error) {
        this.log(
          `Could not close the ${current.harnessId} session before switching to ${harnessId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      // The key names the session we just closed. Leaving it behind would
      // point the new agent's turn at a dead session if the spawn failed.
      const closed = this.requireSession(session.id);
      closed.openclawSessionKey = undefined;
      closed.harnessState = "closed";
      closed.updatedAt = nowIso();
      this.repos.updateSession(closed);
    }
    const result = await this.spawnHarness({
      projectId: current.projectId,
      harnessId,
      sessionId: current.id,
      cwd: current.workingDirectory ?? this.requireProject(current.projectId).workingDirectory,
      mode: current.acpMode ?? "persistent",
      permissionProfile:
        current.permissionProfile === "strict" ||
        current.permissionProfile === "approve-all" ||
        current.permissionProfile === "default"
          ? current.permissionProfile
          : undefined,
      model: current.modelOverride,
    });
    return this.requireSession(result.session.id);
  }

  private attachSessionWorktree(session: Session, project: Project): void {
    if (!project.workingDirectory) throw new Error("Choose a project folder before using a worktree.");
    const slug = session.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36) || "conversation";
    const suffix = session.id.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toLowerCase();
    const branch = applyBranchPrefix(this.settings.branchPrefix ?? "capsule", `${slug}-${suffix}`);
    const destination = path.join(this.options.userDataDir, "worktrees", project.id, session.id);
    const result = createWorktree(project.workingDirectory, destination, branch);
    if (!result.ok || !result.path || !result.branch) throw new Error(result.detail);
    session.workingDirectory = result.path;
    session.worktreeBranch = result.branch;
    session.workspaceMode = "worktree";
    this.log(`Created worktree ${result.branch} for ${session.title}`);
  }

  /*
   * A fresh worktree has no node_modules, no .env, nothing a build needs. The
   * actions marked as setup run once, here, so the first prompt in an isolated
   * conversation is not "install the dependencies".
   */
  private runWorktreeSetupActions(session: Session, project: Project): void {
    const setup = (project.actions ?? []).filter((action) => action.runOnWorktreeCreate);
    for (const action of setup) {
      try {
        this.runProjectAction(project.id, action.id, session.id);
        this.log(`Started setup action ${action.name} in ${session.worktreeBranch}`);
      } catch (error) {
        // A setup action that will not start must not take the worktree with
        // it: the conversation is usable, it just has more to do first.
        this.log(
          `Setup action ${action.name} did not start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private cleanupSessionWorktree(session: Session, project: Project): boolean {
    if (session.workspaceMode !== "worktree" || !session.workingDirectory) return true;
    if (!project.workingDirectory) {
      this.log(`Kept worktree ${session.workingDirectory}; project folder is unavailable.`);
      return false;
    }
    const result = removeWorktree(project.workingDirectory, session.workingDirectory);
    this.log(result.detail);
    return result.ok;
  }

  private requireHarnessSession(id: string): Session {
    const session = this.requireSession(id);
    if (!session.harnessId) {
      throw new Error("This conversation is not bound to an ACP harness.");
    }
    return session;
  }

  /*
   * A project as the app sees it: what this machine stored, plus what the
   * repository itself declares in capsule.json. The file is read here rather
   * than cached, because it is a file someone edits with the app open.
   */
  private withProjectIcon(project: Project): Project {
    const state = readProjectFile(project.workingDirectory);
    const file = state.status === "ok" ? state.file : undefined;
    const merged: Project = {
      ...project,
      ...(file
        ? {
            actions: mergeProjectActions(file.actions, project.actions ?? []),
            // The stored value wins: an override made here is a decision, and
            // the file is the default for everyone who has not made one.
            ...(project.defaultWorkspaceMode
              ? {}
              : file.defaultWorkspaceMode
                ? { defaultWorkspaceMode: file.defaultWorkspaceMode }
                : {}),
          }
        : {}),
      projectFile: state,
    };
    const iconDataUrl = readProjectIconDataUrl(
      merged.workingDirectory,
      merged.iconPath ?? file?.iconPath,
    );
    return iconDataUrl ? { ...merged, iconDataUrl } : merged;
  }

  private requireProject(id: string): Project {
    const project = this.repos.getProject(id);
    if (!project) throw new Error("Project not found");
    return project;
  }

  private workingDirectoryFor(project: Project, sessionId?: string): string | undefined {
    if (!sessionId) return project.workingDirectory;
    const session = this.repos.getSession(sessionId);
    if (!session || session.projectId !== project.id) {
      throw new Error("Conversation does not belong to this project.");
    }
    return session.workingDirectory ?? project.workingDirectory;
  }

  private projectActionKey(projectId: string, actionId: string, sessionId?: string): string {
    return `${projectId}:${sessionId ?? "project"}:${actionId}`;
  }

  private resolveProjectFolder(project: Project, root?: string): string {
    const folders = [
      ...projectFolderList(project),
      ...this.repos
        .listSessions(project.id)
        .map((session) => session.workingDirectory)
        .filter((folder): folder is string => Boolean(folder)),
    ];
    if (root?.trim()) {
      const needle = normalizeFolderPath(root.trim()).toLowerCase();
      const match = folders.find((item) => item.toLowerCase() === needle);
      if (!match) throw new Error("That folder is not attached to this project.");
      return match;
    }
    if (!project.workingDirectory) throw new Error("Project has no working directory");
    return project.workingDirectory;
  }

  private requireSession(id: string): Session {
    const session = this.repos.getSession(id);
    if (!session) throw new Error("Session not found");
    return session;
  }

  private requireRun(id: string): Run {
    const run = this.repos.getRun(id);
    if (!run) throw new Error("Run not found");
    return run;
  }

  private log(message: string): void {
    this.logs.push(`${nowIso()} ${message}`);
    if (this.logs.length > 500) this.logs.shift();
  }
}

export function inferMode(prompt: string, current?: AgentMode): AgentMode {
  const lower = prompt.toLowerCase();
  if (/\b(plan|design the approach|write a plan)\b/.test(lower)) return "plan";
  if (/\b(code|implement|refactor|test|git|typescript|python|api)\b/.test(lower)) return "code";
  if (/\b(research|search|sources|summarize the web)\b/.test(lower)) return "research";
  if (/\b(browser|web page|navigate|scrape)\b/.test(lower)) return "browser";
  if (/\b(every day|schedule|cron|automat)/.test(lower)) return "automation";
  return current ?? "chat";
}
