import { EventEmitter } from "node:events";
import { agentIdForMode, DEFAULT_AGENTS, excludeSystemAgents } from "@capsule/agents";
import {
  buildDoctorReport,
  harnessAgentRecord,
  isLiveHarnessState,
  localDoctorChecks,
  PRESET_HARNESSES,
  presetFor,
  probeHarnesses,
  whichBinary,
} from "@capsule/harness";
import { createTextArtifact } from "@capsule/artifacts";
import { createBuzzAdapter } from "@capsule/buzz";
import { buildContract } from "@capsule/contracts";
import { CapsuleDatabase, CapsuleRepositories } from "@capsule/database";
import { FilesystemAdapter } from "@capsule/filesystem";
import { MockAgentRuntime, OpenClawAdapter, defaultGatewayEndpoint } from "@capsule/openclaw";
import { decidePolicy, DEFAULT_POLICIES, recordDecision } from "@capsule/policies";
import { createProjectRecord } from "@capsule/projects";
import { createRunEvent, createRunRecord } from "@capsule/runs";
import { createSessionRecord, titleFromPrompt } from "@capsule/sessions";
import {
  acpDoctorCommand,
  createId,
  nowIso,
  type Agent,
  type AgentMessage,
  type AgentMode,
  type AgentRuntime,
  type ApprovalRequest,
  type CapsuleSettings,
  type ChatMessage,
  type ConnectionState,
  type CreateProjectInput,
  type CreateSessionInput,
  type DiagnosticsSnapshot,
  type HarnessControlResult,
  type HarnessDoctorReport,
  type HarnessId,
  type HarnessLiveStatus,
  type HarnessOptionPatch,
  type HarnessStatus,
  type SpawnHarnessInput,
  type UpdateProjectInput,
  isHarnessId,
  type Project,
  type Run,
  type RunEvent,
  type Session,
  type SubsystemStatus,
} from "@capsule/shared";
import { DEFAULT_SKILLS, skillIdForMode } from "@capsule/skills";
import { openNativeTerminal } from "@capsule/terminal";
import { evaluateRun, verifyContract } from "@capsule/verification";
import {
  CAPSULE_KEYCHAIN_SERVICE,
  GATEWAY_TOKEN_ACCOUNT,
  createKeychainAdapter,
  type KeychainAdapter,
} from "./keychain.js";

export interface CapsuleEngineOptions {
  databasePath: string;
  userDataDir: string;
  gatewayUrl?: string;
  clientVersion?: string;
  capsuleVersion?: string;
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
  private usingMock = true;

  constructor(private readonly options: CapsuleEngineOptions) {
    this.db = new CapsuleDatabase(options.databasePath);
    this.repos = new CapsuleRepositories(this.db);
    this.keychain = createKeychainAdapter(options.userDataDir);
    this.settings = {
      gatewayUrl: options.gatewayUrl ?? defaultGatewayEndpoint().url,
      useMockWhenOffline: true,
      launchAtLogin: false,
      mockScenario: "successful_run",
    };
    this.openclaw = new OpenClawAdapter({
      gatewayUrl: this.settings.gatewayUrl,
      clientVersion: options.clientVersion,
    });
    this.runtime = this.mock;
  }

  async start(): Promise<void> {
    this.bootstrapWorkspace();
    this.loadSettings();
    await this.hydrateSecrets();
    this.openclaw = new OpenClawAdapter({
      gatewayUrl: this.settings.gatewayUrl,
      token: this.settings.gatewayToken,
      clientVersion: this.options.clientVersion,
    });
    await this.connectPreferredRuntime();
    this.log("Capsule engine started");
  }

  async stop(): Promise<void> {
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
    this.openclaw = new OpenClawAdapter({
      gatewayUrl: this.settings.gatewayUrl,
      token: this.settings.gatewayToken,
      clientVersion: this.options.clientVersion,
    });
    try {
      await this.openclaw.connect();
      this.runtime = this.openclaw;
      this.usingMock = false;
      await this.syncRuntimeCatalog();
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
    this.repos.insertProject(project);
    return project;
  }

  getProject(id: string): Project | undefined {
    return this.repos.getProject(id);
  }

  async listAgents(): Promise<Agent[]> {
    const stored = this.repos.listAgents();
    const base = excludeSystemAgents(stored.length > 0 ? stored : DEFAULT_AGENTS);
    const harnesses = await this.listHarnesses();
    const extra = harnesses
      .filter((harness) => !base.some((agent) => agent.id === harness.id))
      .map((harness) =>
        harnessAgentRecord(PRESET_HARNESSES.find((preset) => preset.id === harness.id)!),
      );
    return [...base, ...extra];
  }

  async listHarnesses(): Promise<HarnessStatus[]> {
    const dedicatedByHarness: Record<string, string[]> = { claude: [], codex: [] };
    const liveByHarness: Record<string, string[]> = { claude: [], codex: [] };
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
    const checks = localDoctorChecks({
      preset,
      binaryPath: whichBinary(preset.binaries),
      gatewayConnected: !this.usingMock,
      acpxEnabled,
    });
    let gatewayOutput: string | undefined;
    if (!this.usingMock) {
      try {
        const scratch = await this.openclaw.createSession({
          projectId: this.repos.listProjects()[0]?.id ?? "local",
          agentId: harnessId,
          title: `${preset.name} doctor`,
          mode: "code",
        });
        const key = scratch.openclawSessionKey ?? scratch.id;
        gatewayOutput = await this.openclaw.doctorAcp(key);
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
    const cwd = input.cwd ?? project.workingDirectory;
    const title = input.sessionId
      ? this.requireSession(input.sessionId).title
      : `${preset.name} · ${project.name}`;
    const session = input.sessionId
      ? this.requireSession(input.sessionId)
      : createSessionRecord(project, { projectId: project.id, agentId: harnessId, mode: "code", title }, harnessId);

    session.agentId = harnessId;
    session.mode = "code";
    session.harnessId = harnessId;
    session.harnessState = "spawning";
    session.acpMode = input.mode ?? "persistent";
    session.permissionProfile = input.permissionProfile;
    session.modelOverride = input.model;
    session.updatedAt = nowIso();

    if (this.usingMock) {
      session.harnessState = "running";
      session.openclawSessionKey = session.openclawSessionKey ?? `mock:acp:${harnessId}:${session.id}`;
      if (input.sessionId) this.repos.updateSession(session);
      else this.repos.insertSession(session);
      this.log(`Mock spawn for ${harnessId}; connect OpenClaw to run a real ACP session.`);
      this.events.emit("state", { command: "harness-updated" });
      return { session, usedSlashCommand: false, detail: "Mock ACP session." };
    }

    try {
      const spawned = await this.openclaw.spawnAcpSession({
        harnessId,
        cwd,
        title,
        prompt: input.prompt,
        mode: input.mode ?? "persistent",
        sessionKey: session.openclawSessionKey,
        permissionProfile: input.permissionProfile,
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
    const run = this.listRuns(session.id).find((item) =>
      ["running", "waiting", "approval_required"].includes(item.status),
    );
    if (this.usingMock) {
      if (run) await this.stopRun(run.id);
    } else if (session.openclawSessionKey) {
      await this.openclaw.cancelAcp(session.openclawSessionKey, run?.openclawRunId);
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
      content: `Steer: ${text}`,
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
      await this.openclaw.closeAcp(session.openclawSessionKey).catch((error) => {
        this.log(`ACP close failed: ${String(error)}`);
      });
    }
    session.harnessState = "closed";
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
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
    if (result.parsed.state === "running" || result.parsed.state === "idle") {
      session.harnessState = result.parsed.state === "idle" ? "waiting" : "running";
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
    if (patch.key === "model") session.modelOverride = value;
    if (patch.key === "permissions") session.permissionProfile = value;
    if (patch.key === "mode" && (value === "persistent" || value === "oneshot")) {
      session.acpMode = value;
    }
    if (patch.key === "cwd") {
      const project = this.requireProject(session.projectId);
      project.workingDirectory = value;
      project.updatedAt = nowIso();
      this.repos.updateProject(project);
    }
    let statusText: string | undefined;
    if (!this.usingMock && session.openclawSessionKey) {
      statusText = await this.openclaw.setAcpOption(session.openclawSessionKey, patch.key, value);
    }
    session.updatedAt = nowIso();
    this.repos.updateSession(session);
    this.log(`Set harness ${patch.key}=${value} on ${session.id}`);
    return { session, detail: `Updated ${patch.key}.`, statusText };
  }

  listHarnessSessions(projectId?: string): Session[] {
    return this.repos
      .listSessions(projectId)
      .filter((session) => Boolean(session.harnessId) && session.state === "active");
  }

  updateProject(id: string, patch: UpdateProjectInput): Project {
    const project = this.requireProject(id);
    if (patch.name !== undefined) project.name = patch.name.trim() || project.name;
    if (patch.description !== undefined) project.description = patch.description;
    if (patch.workingDirectory !== undefined) {
      project.workingDirectory = patch.workingDirectory ?? undefined;
    }
    if (patch.defaultAgentId !== undefined) {
      project.defaultAgentId = patch.defaultAgentId ?? undefined;
    }
    if (patch.defaultMode !== undefined) project.defaultMode = patch.defaultMode;
    project.updatedAt = nowIso();
    this.repos.updateProject(project);
    return project;
  }

  async listSkills() {
    const stored = this.repos.listSkills();
    return stored.length > 0 ? stored : DEFAULT_SKILLS;
  }

  listSessions(projectId?: string): Session[] {
    return this.repos.listSessions(projectId);
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const project = this.requireProject(input.projectId);
    const agentId = input.agentId ?? project.defaultAgentId ?? agentIdForMode(input.mode ?? project.defaultMode);
    const session = createSessionRecord(project, input, agentId);
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

  listMessages(sessionId: string): ChatMessage[] {
    return this.repos.listMessages(sessionId);
  }

  async sendMessage(input: AgentMessage): Promise<{ session: Session; run: Run; userMessage: ChatMessage }> {
    let session = this.requireSession(input.sessionId);
    const project = this.requireProject(session.projectId);
    const mode = input.mode ?? session.mode;
    const harnessId = this.resolveHarnessId(session, project, input.agentId, mode);
    if (harnessId) {
      session = await this.ensureHarnessSession(session, harnessId);
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
      workingDirectory: project.workingDirectory,
      runId: run.id,
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

    const runtimeMessage: AgentMessage = {
      ...input,
      sessionId: this.usingMock ? session.id : (session.openclawSessionKey ?? session.id),
      agentId,
      skillId,
      mode,
    };

    const runtimeRun = await this.runtime.sendMessage(runtimeMessage);
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

  listFiles(projectId: string, relative = ".") {
    const project = this.requireProject(projectId);
    return new FilesystemAdapter(project.workingDirectory).list(relative);
  }

  readFile(projectId: string, relative: string): string {
    const project = this.requireProject(projectId);
    const decision = decidePolicy(this.repos.listPolicies(), "filesystem", "read");
    if (decision.decision === "block") throw new Error("Filesystem read is blocked by policy");
    return new FilesystemAdapter(project.workingDirectory).read(relative);
  }

  writeFile(projectId: string, relative: string, content: string): void {
    const project = this.requireProject(projectId);
    const decision = decidePolicy(this.repos.listPolicies(), "filesystem", "write");
    if (decision.decision === "block") throw new Error("Filesystem write is blocked by policy");
    if (decision.decision === "approval") {
      throw new Error("Filesystem write requires approval");
    }
    new FilesystemAdapter(project.workingDirectory).write(relative, content);
  }

  openTerminal(projectId: string): void {
    const project = this.requireProject(projectId);
    if (!project.workingDirectory) throw new Error("Project has no working directory");
    openNativeTerminal(project.workingDirectory);
  }

  getSettings(): CapsuleSettings {
    return { ...this.settings, gatewayToken: this.settings.gatewayToken ? "••••" : undefined };
  }

  async updateSettings(patch: Partial<CapsuleSettings>): Promise<CapsuleSettings> {
    this.settings = { ...this.settings, ...patch };
    if (patch.gatewayToken) {
      await this.keychain.set(CAPSULE_KEYCHAIN_SERVICE, GATEWAY_TOKEN_ACCOUNT, patch.gatewayToken);
    }
    if (patch.mockScenario) this.mock.setScenario(patch.mockScenario);
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

  search(query: string) {
    const needle = query.trim().toLowerCase();
    if (!needle) return { projects: [], sessions: [], runs: [] };
    return {
      projects: this.listProjects().filter((project) => project.name.toLowerCase().includes(needle)),
      sessions: this.listSessions().filter((session) => session.title.toLowerCase().includes(needle)),
      runs: this.listRuns().filter((run) => run.prompt.toLowerCase().includes(needle)),
    };
  }

  private async connectPreferredRuntime(): Promise<void> {
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
    const agents = await this.runtime.listAgents().catch(() => DEFAULT_AGENTS);
    for (const agent of agents.length > 0 ? agents : DEFAULT_AGENTS) {
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
      if (status === "completed") {
        const contract = run.contractId ? this.repos.getContract(run.contractId) : undefined;
        if (contract) {
          const verification = verifyContract({
            contract,
            output: run.result ?? "",
            workingDirectory: this.getProject(run.projectId)?.workingDirectory,
            forceFail: Boolean(event.data?.forceVerifyFail),
          });
          const evaluation = evaluateRun(run.result ?? "", verification);
          const artifact = createTextArtifact({
            session,
            run,
            title: verification.passed ? "Run result" : "Verification report",
            content: [
              `# ${verification.summary}`,
              "",
              evaluation.summary,
              "",
              run.result ?? "",
            ].join("\n"),
            kind: verification.passed ? "report" : "report",
          });
          this.repos.insertArtifact(artifact);
          if (!verification.passed) {
            run.status = "failed";
            run.error = verification.summary;
          }
          this.appendEvent(run.id, "verification", verification.summary, {
            passed: verification.passed,
          });
        }
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

  private bootstrapWorkspace(): void {
    const existing = this.repos.listWorkspaces()[0];
    if (existing) {
      this.workspaceId = existing.id;
      if (this.repos.listProjects().length === 0) {
        this.createProject({ name: "Inbox", description: "Default workspace for new tasks." });
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
    this.createProject({ name: "Inbox", description: "Default workspace for new tasks." });
    for (const agent of DEFAULT_AGENTS) this.repos.upsertAgent(agent);
    for (const skill of DEFAULT_SKILLS) this.repos.upsertSkill(skill);
    for (const rule of DEFAULT_POLICIES) this.repos.insertPolicy(rule);
  }

  private loadSettings(): void {
    const raw = this.repos.getSetting("settings");
    if (!raw) return;
    try {
      this.settings = { ...this.settings, ...(JSON.parse(raw) as CapsuleSettings) };
    } catch {
      // Keep defaults if persisted settings are unreadable.
    }
  }

  private persistSettings(): void {
    const stored = { ...this.settings };
    delete stored.gatewayToken;
    this.repos.setSetting("settings", JSON.stringify(stored));
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
      throw new Error("This conversation is not bound to a Claude Code or Codex harness.");
    }
    return session;
  }

  private requireProject(id: string): Project {
    const project = this.repos.getProject(id);
    if (!project) throw new Error("Project not found");
    return project;
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
  if (/\b(code|implement|refactor|test|git|typescript|python|api)\b/.test(lower)) return "code";
  if (/\b(research|search|sources|summarize the web)\b/.test(lower)) return "research";
  if (/\b(browser|web page|navigate|scrape)\b/.test(lower)) return "browser";
  if (/\b(every day|schedule|cron|automat)/.test(lower)) return "automation";
  return current ?? "chat";
}
