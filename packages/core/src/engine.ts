import { EventEmitter } from "node:events";
import path from "node:path";
import { agentIdForMode, DEFAULT_AGENTS, excludeSystemAgents } from "@capsule/agents";
import {
  buildDoctorReport,
  clearBinaryCache,
  clearLoginCache,
  harnessAgentRecord,
  isLiveHarnessState,
  localDoctorChecks,
  PRESET_HARNESSES,
  probeLoginState,
  presetFor,
  probeHarnesses,
  whichBinary,
} from "@capsule/harness";

import { createBuzzAdapter } from "@capsule/buzz";
import { buildContract } from "@capsule/contracts";
import { CapsuleDatabase, CapsuleRepositories } from "@capsule/database";
import {
  checkoutBranch as checkoutGitBranch,
  commitAll,
  createBranch as createGitBranch,
  createPullRequest as openPullRequest,
  discardFile,
  enrichGitStatus,
  FilesystemAdapter,
  lastCommitSubject,
  mergePullRequest as mergeGithubPullRequest,
  pushCurrentBranch,
  readGitDiff,
  readGitStatus,
  searchContents,
  stageFile,
  viewPullRequest,
} from "@capsule/filesystem";
import {
  MockAgentRuntime,
  OpenClawAdapter,
  acpCommandFailed,
  acpxModeIsNonFatal,
  defaultGatewayEndpoint,
} from "@capsule/openclaw";
import { decidePolicy, DEFAULT_POLICIES, policiesFromSettings, recordDecision } from "@capsule/policies";
import { createProjectRecord } from "@capsule/projects";
import { createRunEvent, createRunRecord } from "@capsule/runs";
import { createSessionRecord, titleFromPrompt } from "@capsule/sessions";
import {
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
  TOKEN_PRESENT_MASK,
  type ConnectionState,
  type CreateProjectInput,
  type CreateSessionInput,
  type DiagnosticsSnapshot,
  type ContentHit,
  type FileEntry,
  type GitStatus,
  type HarnessControlResult,
  type HarnessDoctorReport,
  type HarnessId,
  type HarnessPermissionProfile,
  type HarnessLiveStatus,
  type HarnessOptionPatch,
  type HarnessStatus,
  type SpawnHarnessInput,
  type UpdateProjectInput,
  isHarnessId,
  type MessagePage,
  type Project,
  type SearchResults,
  type Run,
  type RunEvent,
  type Session,
  type Skill,
  type SkillPack,
  type SkillsShSearchResult,
  type SkillsShSkillDetail,
  type SubsystemStatus,
} from "@capsule/shared";
import { DEFAULT_SKILLS, DEFAULT_SKILL_PACKS, SkillsShClient, skillIdForMode } from "@capsule/skills";
import { openNativeTerminal, runInDirectory } from "@capsule/terminal";
import { verifyContract } from "@capsule/verification";
import {
  CAPSULE_KEYCHAIN_SERVICE,
  GATEWAY_TOKEN_ACCOUNT,
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
  /** When false, start() stays on the mock runtime and does not probe the Gateway. */
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
  private settings: CapsuleSettings;
  private logs: string[] = [];
  private stopped = false;
  private usingMock = true;
  private acpBuffers = new Map<string, string>();
  private acpUnsub?: () => void;
  private prWatchers = new Map<string, ReturnType<typeof setInterval>>();
  private prFixFingerprints = new Map<string, string>();
  private prWatchSessions = new Map<string, string>();
  private skillsClient = new SkillsShClient();

  constructor(private readonly options: CapsuleEngineOptions) {
    this.db = new CapsuleDatabase(options.databasePath);
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
    this.stopAllPrWatch();
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
      this.usingMock = false;
      await this.syncRuntimeCatalog();
      this.bindAcpReplies();
      this.log(`Connected to OpenClaw Gateway at ${this.settings.gatewayUrl}`);
      this.events.emit("connection", await this.runtime.getStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Gateway connect failed: ${message}`);
      if (this.settings.useMockWhenOffline) {
        this.mock.setScenario(this.settings.mockScenario);
        await this.mock.connect();
        this.runtime = this.mock;
        this.usingMock = true;
        await this.syncRuntimeCatalog();
        this.events.emit("connection", await this.runtime.getStatus());
        return;
      }
      throw error;
    }
  }

  async disconnectGateway(): Promise<void> {
    await this.runtime.disconnect();
    this.events.emit("connection", await this.getStatus());
  }

  listProjects(): Project[] {
    return this.repos.listProjects();
  }

  createProject(input: CreateProjectInput): Project {
    const project = createProjectRecord(this.workspaceId, input);
    if (isInboxProject(project) && !project.workingDirectory) {
      project.workingDirectory = ensureProjectlessFolder(this.projectlessRoot());
    }
    this.repos.insertProject(project);
    return project;
  }

  getProject(id: string): Project | undefined {
    return this.repos.getProject(id);
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

  async listHarnesses(): Promise<HarnessStatus[]> {
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
    let acpxEnabled = false;
    if (!this.usingMock) {
      acpxEnabled = await this.openclaw.hasAcpxPlugin().catch(() => false);
    }
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
    let acpxEnabled = false;
    if (!this.usingMock) {
      acpxEnabled = await this.openclaw.hasAcpxPlugin().catch(() => false);
    }
    // Explicit environment re-check: drop cached lookups so a CLI installed —
    // or signed into — since launch is picked up.
    clearBinaryCache();
    clearLoginCache();
    const binaryPath = whichBinary(preset.binaries);
    let acpxPermissionModeValue: string | undefined;
    let acpxPolicyKnown = false;
    if (!this.usingMock && acpxEnabled) {
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
      loginState: this.usingMock ? undefined : probeLoginState(preset, binaryPath),
      acpxPermissionMode: acpxPermissionModeValue,
      acpxPolicyKnown,
    });
    let gatewayOutput: string | undefined;
    if (!this.usingMock) {
      try {
        const scratch = await this.openclaw.createSession({
          projectId: this.repos.listProjects()[0]?.id ?? "local",
          title: `${preset.name} doctor`,
          mode: "code",
        });
        const key = scratch.openclawSessionKey ?? scratch.id;
        gatewayOutput = await this.openclaw.doctorAcp(key);
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
    if (!this.usingMock) {
      const loginState = probeLoginState(preset, whichBinary(preset.binaries));
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
      : createSessionRecord(project, { projectId: project.id, agentId: harnessId, mode: "code", title }, harnessId);
    if (!session.workingDirectory && isInboxProject(project)) {
      session.workingDirectory = allocateThreadFolder(
        ensureProjectlessFolder(this.projectlessRoot()),
        title,
      );
    }
    const cwd = input.cwd ?? session.workingDirectory ?? project.workingDirectory;

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
          "Mock session only. Connect the OpenClaw Gateway and enable acpx, then spawn again for a real Claude or Codex run.",
      };
    }

    try {
      const spawned = await this.openclaw.spawnAcpSession({
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
        await this.openclaw.cancelAcp(session.openclawSessionKey, run?.openclawRunId);
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
      await this.openclaw.steerAcp(session.openclawSessionKey, text);
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
        await this.openclaw.closeAcp(session.openclawSessionKey);
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
    const result = await this.openclaw.statusAcp(session.openclawSessionKey);
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
      statusText = await this.openclaw.setAcpOption(session.openclawSessionKey, patch.key, value);
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
    if (patch.defaultAgentId !== undefined) {
      project.defaultAgentId = patch.defaultAgentId ?? undefined;
    }
    if (patch.defaultMode !== undefined) project.defaultMode = patch.defaultMode;
    project.updatedAt = nowIso();
    this.repos.updateProject(project);
    return project;
  }

  deleteProject(id: string): void {
    this.requireProject(id);
    this.repos.deleteProject(id);
    if (this.repos.listProjects().length === 0) {
      this.createProject({
        name: INBOX_PROJECT_NAME,
        description: "Tasks started outside a project.",
      });
    }
    this.events.emit("state", { command: "projects-updated" });
  }

  gitStatus(projectId: string): GitStatus {
    const project = this.requireProject(projectId);
    const status = enrichGitStatus(
      readGitStatus(project.workingDirectory),
      project.workingDirectory,
    );
    if (status.pullRequest && pullRequestWatchEnabled(this.settings)) {
      this.schedulePrWatch(projectId);
    } else if (!status.pullRequest) {
      this.stopPrWatch(projectId);
    }
    return status;
  }

  gitDiff(projectId: string, relative?: string): string {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) return "";
    return readGitDiff(project.workingDirectory, relative);
  }

  checkoutBranch(projectId: string, branch: string): GitStatus {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Project has no working directory");
    const result = checkoutGitBranch(project.workingDirectory, branch);
    if (!result.ok) throw new Error(result.detail);
    return readGitStatus(project.workingDirectory);
  }

  gitCommit(projectId: string, message: string): GitStatus {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Project has no working directory");
    const result = commitAll(project.workingDirectory, message);
    if (!result.ok) throw new Error(result.detail);
    return this.gitStatus(projectId);
  }

  gitStage(projectId: string, relative: string): GitStatus {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Project has no working directory");
    const result = stageFile(project.workingDirectory, relative);
    if (!result.ok) throw new Error(result.detail);
    return readGitStatus(project.workingDirectory);
  }

  gitDiscard(projectId: string, relative: string): GitStatus {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Project has no working directory");
    const result = discardFile(project.workingDirectory, relative);
    if (!result.ok) throw new Error(result.detail);
    return readGitStatus(project.workingDirectory);
  }

  gitCreateBranch(projectId: string, branch: string): GitStatus {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Project has no working directory");
    const result = createGitBranch(
      project.workingDirectory,
      applyBranchPrefix(this.settings.branchPrefix, branch),
    );
    if (!result.ok) throw new Error(result.detail);
    return this.gitStatus(projectId);
  }

  gitPush(projectId: string): GitStatus {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Project has no working directory");
    const result = pushCurrentBranch(project.workingDirectory, this.settings.gitForceWithLease);
    if (!result.ok) throw new Error(result.detail);
    this.log(result.detail);
    return this.gitStatus(projectId);
  }

  async gitCreatePullRequest(
    projectId: string,
    input?: { title?: string; body?: string; sessionId?: string },
  ): Promise<GitStatus> {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Project has no working directory");
    const pushed = pushCurrentBranch(project.workingDirectory, this.settings.gitForceWithLease);
    if (!pushed.ok) throw new Error(pushed.detail);
    const branch = readGitStatus(project.workingDirectory).branch ?? "HEAD";
    const title =
      input?.title?.trim() ||
      lastCommitSubject(project.workingDirectory) ||
      branch.replace(/^.*\//, "").replace(/[-_]/g, " ");
    const body =
      [input?.body?.trim(), this.settings.prInstructions].filter(Boolean).join("\n\n") || title;
    const opened = openPullRequest(project.workingDirectory, {
      title,
      body,
      draft: this.settings.prDraft,
    });
    if (!opened.ok) throw new Error(opened.detail);
    this.log(opened.detail);
    if (input?.sessionId) this.prWatchSessions.set(projectId, input.sessionId);
    if (this.settings.prAutoMerge) {
      const queued = mergeGithubPullRequest(
        project.workingDirectory,
        this.settings.prMergeMethod,
        true,
      );
      this.log(queued.detail);
    }
    if (pullRequestWatchEnabled(this.settings)) this.schedulePrWatch(projectId, input?.sessionId);
    return this.gitStatus(projectId);
  }

  gitMergePullRequest(projectId: string): GitStatus {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Project has no working directory");
    const result = mergeGithubPullRequest(
      project.workingDirectory,
      this.settings.prMergeMethod,
      this.settings.prAutoMerge,
    );
    if (!result.ok) throw new Error(result.detail);
    this.log(result.detail);
    return this.gitStatus(projectId);
  }

  searchContents(projectId: string, query: string): ContentHit[] {
    const project = this.requireProject(projectId);
    return searchContents(project.workingDirectory, query);
  }

  async listSkills(): Promise<Skill[]> {
    const stored = this.repos.listSkills();
    return stored.length > 0 ? stored : DEFAULT_SKILLS;
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

  async searchSkillsSh(query: string): Promise<SkillsShSearchResult[]> {
    return this.skillsClient.search(query);
  }

  async fetchSkillDetail(source: string, slug: string): Promise<SkillsShSkillDetail | undefined> {
    return this.skillsClient.getSkillDetail(source, slug);
  }

  listSessions(projectId?: string): Session[] {
    return this.repos.listSessions(projectId);
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const project = this.requireProject(input.projectId);
    const agentId = input.agentId ?? project.defaultAgentId ?? agentIdForMode(input.mode ?? project.defaultMode);
    const session = createSessionRecord(project, input, agentId);
    session.permissionProfile = input.permissionProfile ?? this.settings.defaultPermission;
    if (isInboxProject(project) && !session.workingDirectory) {
      session.workingDirectory = allocateThreadFolder(
        ensureProjectlessFolder(this.projectlessRoot()),
        session.title,
      );
    }
    if (!this.usingMock) {
      try {
        const remote = await this.openclaw.createSession({
          ...input,
          projectId: project.id,
          agentId,
        });
        session.openclawSessionKey = remote.openclawSessionKey;
      } catch (error) {
        this.log(`OpenClaw session create failed: ${String(error)}`);
      }
    }
    this.repos.insertSession(session);
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
    this.repos.deleteSession(id);
  }

  pinSession(id: string, pinned: boolean): Session {
    const session = this.requireSession(id);
    session.pinned = pinned;
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    return session;
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
      await this.openclaw.setAcpOption(session.openclawSessionKey, "permissions", profile);
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
      session.title = titleFromPrompt(input.content);
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
      createdAt: nowIso(),
    };
    this.repos.insertMessage(userMessage);
    this.events.emit("message", userMessage);

    const run = createRunRecord({
      sessionId: session.id,
      projectId: project.id,
      agentId,
      skillId,
      prompt: input.content,
    });
    run.status = "running";
    this.repos.insertRun(run);

    const contract = buildContract({
      mode,
      prompt: input.content,
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
      const activeSkill = this.repos.getSkill(skillId) ?? DEFAULT_SKILLS.find((s) => s.id === skillId);
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
      content: applyAgentInstructionHints(input.content + skillInstruction, this.settings),
      sessionId: this.usingMock ? session.id : (session.openclawSessionKey ?? session.id),
      agentId: this.usingMock ? agentId : undefined,
      skillId,
      mode,
    };

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

  async openTerminal(projectId: string): Promise<void> {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Choose a project folder first");
    await openNativeTerminal(project.workingDirectory);
  }

  async execInProject(projectId: string, command: string) {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Choose a project folder first");
    if (this.settings.sandbox === "strict") {
      throw new Error("Strict sandbox blocks project terminal commands.");
    }
    return runInDirectory(project.workingDirectory, command);
  }

  getSettings(): CapsuleSettings {
    return {
      ...this.settings,
      gatewayToken: this.settings.gatewayToken ? TOKEN_PRESENT_MASK : undefined,
    };
  }

  async updateSettings(patch: Partial<CapsuleSettings>): Promise<CapsuleSettings> {
    const { gatewayToken, ...rest } = patch;
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
    if (patch.mockScenario) this.mock.setScenario(this.settings.mockScenario);
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
  }

  private handleAcpReply(payload: {
    sessionKey?: string;
    text?: string;
    done?: boolean;
    control?: boolean;
  }): void {
    if (!payload.sessionKey) return;
    if (payload.control) return;
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
    const message: ChatMessage = {
      id: createId("msg"),
      sessionId: session.id,
      role: "assistant",
      content,
      createdAt: nowIso(),
    };
    this.repos.insertMessage(message);
    this.events.emit("message", message);
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

  private async connectPreferredRuntime(): Promise<void> {
    if (this.options.autoConnect === false) {
      this.mock.setScenario(this.settings.mockScenario);
      await this.mock.connect();
      this.runtime = this.mock;
      this.usingMock = true;
      await this.syncRuntimeCatalog();
      return;
    }
    try {
      await this.connectGateway();
    } catch (error) {
      this.log(`Falling back to mock runtime: ${String(error)}`);
      this.mock.setScenario(this.settings.mockScenario);
      await this.mock.connect();
      this.runtime = this.mock;
      this.usingMock = true;
      await this.syncRuntimeCatalog();
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
        if (contract) {
          const verification = verifyContract({
            contract,
            output: run.result ?? "",
            workingDirectory: this.getProject(run.projectId)?.workingDirectory,
            forceFail: Boolean(event.data?.forceVerifyFail),
          });
          if (!verification.passed) {
            run.status = "failed";
            run.error = verification.summary;
          }
          this.appendEvent(run.id, "verification", verification.summary, {
            passed: verification.passed,
          });
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

  private failStaleRuns(): void {
    for (const run of this.repos.listRuns()) {
      if (!["running", "waiting", "queued"].includes(run.status)) continue;
      run.status = "failed";
      run.error = run.error ?? "Interrupted when Capsule last quit.";
      run.updatedAt = nowIso();
      run.completedAt = nowIso();
      this.repos.updateRun(run);
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

  private async hydrateSecrets(): Promise<void> {
    const token = await this.keychain.get(CAPSULE_KEYCHAIN_SERVICE, GATEWAY_TOKEN_ACCOUNT);
    if (token) this.settings.gatewayToken = token;
    if (process.env.OPENCLAW_GATEWAY_TOKEN) {
      this.settings.gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
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
    if (isLiveHarnessState(current.harnessState) && (this.usingMock || current.openclawSessionKey)) {
      return current;
    }
    const result = await this.spawnHarness({
      projectId: current.projectId,
      harnessId,
      sessionId: current.id,
      cwd: this.requireProject(current.projectId).workingDirectory,
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

  private requireHarnessSession(id: string): Session {
    const session = this.requireSession(id);
    if (!session.harnessId) {
      throw new Error("This conversation is not bound to an ACP harness.");
    }
    return session;
  }

  private requireProject(id: string): Project {
    const project = this.repos.getProject(id);
    if (!project) throw new Error("Project not found");
    return project;
  }

  private resolveProjectFolder(project: Project, root?: string): string {
    const folders = projectFolderList(project);
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
