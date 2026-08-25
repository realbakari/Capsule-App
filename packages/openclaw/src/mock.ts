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
import { DEFAULT_GATEWAY_HOST, DEFAULT_GATEWAY_PORT, DEFAULT_GATEWAY_URL } from "./discovery.js";

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

  setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
    if (scenario === "disconnected_gateway") this.connected = false;
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
    void this.simulate(run, scenario);
    return run;
  }

  async cancelRun(runId: string): Promise<void> {
    this.emit(runId, "cancelled", "Run cancelled", { status: "cancelled" });
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
      this.emit(approval.runId, "cancelled", "Approval denied", { status: "cancelled" });
      return;
    }
    this.emit(approval.runId, "approval.resolved", "Approval granted", { status: "running" });
    await this.finishSuccess(approval.runId, "Approved and completed the requested write.");
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

  private async simulate(run: Run, scenario: MockScenario): Promise<void> {
    const delay = scenario === "long_running" ? 400 : 180;
    this.emit(run.id, "lifecycle", "Request received", { step: "understand" });
    await sleep(delay);
    this.emit(run.id, "lifecycle", "Agent selected", { step: "route", agentId: run.agentId });
    await sleep(delay);
    this.emit(run.id, "lifecycle", "Skill activated", { step: "skill", skillId: run.skillId });
    await sleep(delay);
    this.emit(run.id, "lifecycle", "Contract created", { step: "contract" });

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
      };
      this.approvals.set(approval.id, approval);
      this.emit(run.id, "approval.requested", "Approval required", {
        approval,
        status: "approval_required",
      });
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
    const output =
      scenario === "buzz_message"
        ? "Handled an inbound Buzz room message and traced it to this Capsule run."
        : [
            "I inspected the request and completed the work.",
            "",
            "Files:",
            "- src/index.ts",
            "",
            "Next step: review the artifact and continue the conversation.",
          ].join("\n");
    await this.finishSuccess(run.id, output, scenario === "verification_failure");
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
