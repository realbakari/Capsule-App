import { EventEmitter } from "node:events";
import { agentIdForMode, DEFAULT_AGENTS, excludeSystemAgents } from "@capsule/agents";
import {
  harnessAgentRecord,
  PRESET_HARNESSES,
  probeHarnesses,
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
  type HarnessId,
  type HarnessStatus,
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
    for (const project of this.repos.listProjects()) {
      if (project.defaultAgentId && isHarnessId(project.defaultAgentId)) {
        dedicatedByHarness[project.defaultAgentId]?.push(project.id);
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
    });
  }

  async dedicateHarness(projectId: string, harnessId: HarnessId): Promise<Project> {
    const project = this.requireProject(projectId);
    const preset = PRESET_HARNESSES.find((item) => item.id === harnessId);
    if (!preset) throw new Error(`Unknown harness: ${harnessId}`);
    this.repos.upsertAgent(harnessAgentRecord(preset));
    project.defaultAgentId = harnessId;
    project.defaultMode = "code";
    project.updatedAt = nowIso();
    this.repos.updateProject(project);
    this.log(`Dedicated ${preset.name} to project ${project.name}`);
    return project;
  }

  async spawnHarness(
    projectId: string,
    harnessId: HarnessId,
    prompt?: string,
  ): Promise<{ session: Session; usedSlashCommand?: boolean }> {
    const project = await this.dedicateHarness(projectId, harnessId);
    const title = `${PRESET_HARNESSES.find((item) => item.id === harnessId)?.name} · ${project.name}`;
    if (this.usingMock) {
      const session = await this.createSession({
        projectId: project.id,
        agentId: harnessId,
        mode: "code",
        title,
      });
      this.log(`Mock spawn for ${harnessId}; connect OpenClaw to run a real ACP session.`);
      return { session };
    }
    const spawned = await this.openclaw.spawnAcpSession({
      harnessId,
      cwd: project.workingDirectory,
      title,
      prompt,
    });
    const session = createSessionRecord(
      project,
      { projectId: project.id, agentId: harnessId, mode: "code", title },
      harnessId,
    );
    session.openclawSessionKey = spawned.sessionKey;
    this.repos.insertSession(session);
    this.log(`Spawned OpenClaw ACP session for ${harnessId} (${spawned.sessionKey})`);
    return { session, usedSlashCommand: spawned.usedSlashCommand };
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
    const session = this.requireSession(input.sessionId);
    const project = this.requireProject(session.projectId);
    const mode = input.mode ?? session.mode;
    const agentId = input.agentId ?? session.agentId ?? agentIdForMode(mode);
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
