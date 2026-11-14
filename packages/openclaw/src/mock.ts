import { EventEmitter } from "node:events";
import { DEFAULT_AGENTS } from "@capsule/agents";
import { DEFAULT_SKILLS } from "@capsule/skills";
import {
  createId,
  nowIso,
  type Agent,
  type AgentMessage,
  type AgentRuntime,
  type ApprovalRequest,
  type ChannelBinding,
  type CreateSessionInputRuntime,
  type MockScenario,
  type Run,
  type RunEvent,
  type RunEventHandler,
  type RuntimeStatus,
  type Session,
  type Skill,
  type Unsubscribe,
} from "@capsule/shared";
import { FilesystemAdapter } from "@capsule/filesystem";
import { DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT, DEFAULT_GATEWAY_URL } from "./discovery.js";

const MOCK_PLAN_STEPS = [
  "Read the files the request touches",
  "Make the change in the smallest place that carries it",
  "Add a test for the new behaviour",
  "Run the checks and report what changed",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockAgentRuntime implements AgentRuntime {
  readonly kind = "mock" as const;
  scenario: MockScenario = "successful_run";
  private connected = false;
  private readonly emitter = new EventEmitter();
  private agents: Agent[] = DEFAULT_AGENTS.map((agent) => ({ ...agent }));
  private skills: Skill[] = DEFAULT_SKILLS.map((skill) => ({ ...skill }));
  private readonly sessions = new Map<string, Session>();
  private readonly approvals = new Map<string, ApprovalRequest>();
  private workspace?: string;

  setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
    if (scenario === "disconnected_gateway") this.connected = false;
  }

  setWorkspace(directory?: string): void {
    this.workspace = directory;
  }

  async connect(): Promise<void> {
    if (this.scenario === "disconnected_gateway") {
      throw new Error("Mock Gateway is disconnected");
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getStatus(): Promise<RuntimeStatus> {
    return {
      state: this.connected ? "connected" : "disconnected",
      kind: "mock",
      gatewayUrl: DEFAULT_GATEWAY_URL,
      gatewayHost: DEFAULT_GATEWAY_HOST,
      gatewayPort: DEFAULT_GATEWAY_PORT,
      openclawVersion: "mock",
      protocol: 4,
      agentCount: this.agents.length,
      sessionCount: this.sessions.size,
      activeRunCount: this.agents.filter((agent) => agent.status === "running").length,
    };
  }

  async listAgents(): Promise<Agent[]> {
    return this.agents.map((agent) => ({ ...agent }));
  }

  async listSkills(): Promise<Skill[]> {
    return this.skills.map((skill) => ({ ...skill }));
  }

  async listChannels(): Promise<ChannelBinding[]> {
    if (this.scenario !== "buzz_message") return [];
    return [
      {
        id: "buzz_demo",
        channel: "buzz",
        channelId: "buzz:demo-room",
        displayName: "Buzz",
        room: "engineering",
        thread: "thread-1",
        sender: "alice",
        status: "connected",
      },
    ];
  }

  async createSession(input: CreateSessionInputRuntime): Promise<Session> {
    const timestamp = nowIso();
    const session: Session = {
      id: createId("sess"),
      workspaceId: "mock",
      projectId: input.projectId,
      agentId: input.agentId ?? "general",
      title: input.title ?? "Mock session",
      mode: input.mode ?? "chat",
      state: "active",
      openclawSessionKey: createId("oc"),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async sendMessage(input: AgentMessage): Promise<Run> {
    const scenario = this.detectScenario(input.content);
    const timestamp = nowIso();
    const run: Run = {
      id: createId("run"),
      sessionId: input.sessionId,
      projectId: this.sessions.get(input.sessionId)?.projectId ?? "unknown",
      agentId: input.agentId ?? "general",
      skillId: input.skillId,
      status: scenario === "approval_required" ? "approval_required" : "running",
      prompt: input.content,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    void this.simulate(run, scenario, input.turnMode === "plan");
    return run;
  }

  async cancelRun(runId: string): Promise<void> {
    this.emit(runId, "lifecycle", "Run cancelled", { status: "cancelled" });
  }

  subscribeToRun(runId: string, handler: RunEventHandler): Unsubscribe {
    const wrapped = (event: RunEvent) => {
      if (event.runId === runId) handler(event);
    };
    this.emitter.on("run", wrapped);
    return () => this.emitter.off("run", wrapped);
  }

  async resolveApproval(
    approvalId: string,
    decision: "approved_once" | "approved_session" | "denied",
  ): Promise<void> {
    const approval = this.approvals.get(approvalId);
    if (!approval) return;
    approval.status = decision;
    approval.resolvedAt = nowIso();
    if (decision === "denied") {
      this.emit(approval.runId, "lifecycle", "Approval denied", { status: "cancelled" });
      return;
    }
    this.emit(approval.runId, "approval.resolved", "Approval granted", { status: "running" });
    await this.finishSuccess(approval.runId, "Approved and completed the requested write.");
  }

  async answerQuestion(approvalId: string, answers: Record<string, string[]>): Promise<void> {
    const approval = this.approvals.get(approvalId);
    if (!approval) return;
    approval.status = "approved_once";
    approval.resolvedAt = nowIso();
    this.emit(approval.runId, "approval.resolved", "Question answered", { status: "running" });
    const chosen = Object.values(answers).map((values) => values.join(", ")).join("; ");
    await this.finishSuccess(approval.runId, `Going with ${chosen}.`);
  }

  async listApprovals(): Promise<ApprovalRequest[]> {
    return [...this.approvals.values()];
  }

  private detectScenario(content: string): MockScenario {
    const lower = content.toLowerCase();
    if (lower.includes("[fail]")) return "failed_run";
    if (lower.includes("[approval]")) return "approval_required";
    if (lower.includes("[verify]")) return "verification_failure";
    if (lower.includes("[multi]")) return "multi_agent";
    if (lower.includes("[long]")) return "long_running";
    if (lower.includes("[buzz]")) return "buzz_message";
    if (lower.includes("[tool]")) return "tool_failure";
    if (lower.includes("[work]")) return "tool_run";
    if (lower.includes("[question]")) return "agent_question";
    return this.scenario;
  }

  private emit(runId: string, type: string, message: string, data?: Record<string, unknown>): void {
    const event: RunEvent = {
      id: createId("evt"),
      runId,
      timestamp: nowIso(),
      type,
      message,
      data,
    };
    this.emitter.emit("run", event);
  }

  /** A realistic run of reads, commands and edits with file paths, one failing, slow enough to watch. */
  private async simulateToolRun(runId: string): Promise<void> {
    const steps: Array<{ kind: string; title: string; path?: string; command?: string; fails?: boolean }> = [
      { kind: "read", title: "Read README.md", path: "README.md" },
      { kind: "read", title: "Read package.json", path: "package.json" },
      { kind: "execute", title: "git status", command: "git status --short" },
      { kind: "read", title: "Read src/index.ts", path: "src/index.ts" },
      { kind: "edit", title: "Edit src/index.ts", path: "src/index.ts" },
      { kind: "execute", title: "npm test", command: "npm test", fails: true },
      { kind: "edit", title: "Edit README.md", path: "README.md" },
    ];
    for (const [index, step] of steps.entries()) {
      const toolCallId = `mock-tool-${index}`;
      const base = {
        toolCallId, kind: step.kind, title: step.title,
        ...(step.path ? { locations: [{ path: step.path }], rawInput: { path: step.path } } : { rawInput: { command: step.command } }),
      };
      this.emit(runId, "tool", step.title, { ...base, status: "in_progress" });
      await sleep(700);
      this.emit(runId, "tool", step.title, { ...base, status: step.fails ? "failed" : "completed", ...(step.command ? { rawOutput: step.fails ? "1 test failed" : "" } : {}) });
    }
  }

  private async simulate(run: Run, scenario: MockScenario, planning = false): Promise<void> {
    const delay = scenario === "long_running" ? 400 : 180;
    this.emit(run.id, "lifecycle", "Request received", { step: "understand" });
    await sleep(delay);
    this.emit(run.id, "lifecycle", "Agent selected", { step: "route", agentId: run.agentId });
    await sleep(delay);
    this.emit(run.id, "lifecycle", "Skill activated", { step: "skill", skillId: run.skillId });
    await sleep(delay);
    this.emit(run.id, "lifecycle", "Contract created", { step: "contract" });

    if (scenario === "agent_question") {
      const approval: ApprovalRequest = {
        id: createId("apr"),
        runId: run.id,
        agentId: run.agentId,
        agentName: this.agents.find((agent) => agent.id === run.agentId)?.name ?? "Agent",
        action: "The agent has a question",
        target: "Which database should the app use?",
        reason: "The agent is waiting for your answer.",
        status: "pending",
        createdAt: nowIso(),
        details: { kind: "question", locations: [], truncated: false, canApproveOnce: true, questions: [
          { id: "db", header: "Database", question: "Which database should the app use?", multiSelect: false, allowOther: true, secret: false, options: [
            { label: "SQLite", description: "One file next to the app; nothing to run." },
            { label: "Postgres", description: "A server; better for many writers." },
          ] },
          { id: "checks", header: "Checks", question: "Which checks should run before each commit?", multiSelect: true, allowOther: false, secret: false, options: [
            { label: "Lint" }, { label: "Type check" }, { label: "Unit tests" },
          ] },
        ] },
      };
      this.approvals.set(approval.id, approval);
      this.emit(run.id, "approval.requested", "Question asked", { approval, status: "approval_required" });
      return;
    }

    if (scenario === "approval_required") {
      const approval: ApprovalRequest = {
        id: createId("apr"),
        runId: run.id,
        agentId: run.agentId,
        agentName: this.agents.find((agent) => agent.id === run.agentId)?.name ?? "Agent",
        action: "Write",
        target: "~/Projects/app/src/router.ts",
        reason: "Implement requested feature.",
        status: "pending",
        createdAt: nowIso(),
        details: {
          kind: "edit", locations: ["~/Projects/app/src/router.ts"], truncated: false, canApproveOnce: true,
          subject: { kind: "edit", title: "Write", paths: ["~/Projects/app/src/router.ts"] },
        },
      };
      this.approvals.set(approval.id, approval);
      this.emit(run.id, "approval.requested", "Approval required", {
        approval,
        status: "approval_required",
      });
      return;
    }

    if (scenario === "tool_run") {
      await this.simulateToolRun(run.id);
      await this.finishSuccess(run.id, await this.describeMockReply());
      return;
    }
    this.emit(run.id, "tool.started", "Tool started", { step: "tools" });
    await sleep(delay);
    if (scenario === "tool_failure") {
      this.emit(run.id, "tool.failed", "Tool failed", { status: "failed" });
      this.emit(run.id, "lifecycle", "Run failed", {
        status: "failed",
        error: "Tool execution failed",
      });
      return;
    }
    this.emit(run.id, "tool.completed", "Tool completed");
    if (scenario === "multi_agent") {
      this.emit(run.id, "agent.child", "Research Agent complete", { agent: "research", state: "complete" });
      this.emit(run.id, "agent.child", "Coding Agent working", { agent: "coding", state: "working" });
      this.emit(run.id, "agent.child", "Review Agent waiting", { agent: "review", state: "waiting" });
    }
    await sleep(delay);
    if (scenario === "failed_run") {
      this.emit(run.id, "lifecycle", "Run failed", {
        status: "failed",
        error: "The mock agent could not complete this task.",
      });
      return;
    }
    if (planning) {
      this.emit(run.id, "plan", "Plan", { entries: MOCK_PLAN_STEPS.map((content, index) => ({ id: String(index + 1), content, status: "pending" })) });
      await this.finishSuccess(run.id, ["Mock runtime plan. Nothing was edited.", "", ...MOCK_PLAN_STEPS.map((step, index) => `${index + 1}. ${step}`)].join("\n"));
      return;
    }
    const output =
      scenario === "buzz_message"
        ? "Handled an inbound channel message and traced it to this Capsule run."
        : await this.describeMockReply();
    await this.finishSuccess(run.id, output, scenario === "verification_failure");
  }

  private async describeMockReply(): Promise<string> {
    const listing = await this.listWorkspace();
    return [
      "Mock runtime — OpenClaw Gateway is offline.",
      "Nothing was edited. This is not Claude Code or Codex.",
      "",
      listing,
      "",
      "Connect the Gateway, enable acpx, open a folder with ⌘O, then spawn a harness to work in this repo.",
    ].join("\n");
  }

  private async listWorkspace(): Promise<string> {
    if (!this.workspace) {
      return "No project folder is open, so Capsule is not reading any files.";
    }
    const entries = await new FilesystemAdapter(this.workspace).search("", 20);
    if (entries.length === 0) {
      return `Project folder: ${this.workspace}\nThe folder is empty or unreadable from Capsule.`;
    }
    const lines = entries
      .slice(0, 16)
      .map((entry) => `- ${entry.path}${entry.type === "directory" ? "/" : ""}`);
    return [`Project folder: ${this.workspace}`, "Files Capsule can see:", ...lines].join("\n");
  }

  private async finishSuccess(
    runId: string,
    output: string,
    forceVerifyFail = false,
  ): Promise<void> {
    this.emit(runId, "assistant", output, { stream: "assistant" });
    this.emit(runId, "lifecycle", "Verification started", { step: "verify" });
    await sleep(120);
    this.emit(runId, "lifecycle", "Run completed", {
      status: forceVerifyFail ? "completed" : "completed",
      output,
      forceVerifyFail,
    });
  }
}
