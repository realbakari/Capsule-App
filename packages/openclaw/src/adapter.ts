import { EventEmitter } from "node:events";
import { GatewayClient } from "@openclaw/gateway-client";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
} from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import type { EventFrame, HelloOk } from "@openclaw/gateway-protocol/frame-guards";
import {
  createId,
  nowIso,
  type Agent,
  type AgentMessage,
  type AgentRuntime,
  type ApprovalRequest,
  type ChannelBinding,
  type ChannelName,
  type ConnectionState,
  type CreateSessionInputRuntime,
  type Run,
  type RunEvent,
  type RunEventHandler,
  type RuntimeStatus,
  type Session,
  type Skill,
  type Unsubscribe,
} from "@capsule/shared";
import { defaultGatewayEndpoint, parseGatewayUrl, probeTcp } from "./discovery.js";

const CAPSULE_SCOPES = ["operator.read", "operator.write", "operator.approvals"];
const CAPSULE_CAPS = [
  GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
  GATEWAY_CLIENT_CAPS.APPROVALS,
  GATEWAY_CLIENT_CAPS.EXEC_APPROVALS,
  GATEWAY_CLIENT_CAPS.SESSION_SCOPED_EVENTS,
  GATEWAY_CLIENT_CAPS.AGENT_KIND,
];

export interface OpenClawAdapterOptions {
  gatewayUrl?: string;
  token?: string;
  clientVersion?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapChannel(id: string): ChannelName {
  const lower = id.toLowerCase();
  if (lower.includes("buzz")) return "buzz";
  if (lower.includes("telegram")) return "telegram";
  if (lower.includes("discord")) return "discord";
  if (lower.includes("slack")) return "slack";
  if (lower.includes("whatsapp")) return "whatsapp";
  if (lower.includes("web")) return "web";
  return "other";
}

export class OpenClawAdapter implements AgentRuntime {
  readonly kind = "openclaw" as const;
  private client: GatewayClient | undefined;
  private hello: HelloOk | undefined;
  private connectionState: ConnectionState = "disconnected";
  private lastError: string | undefined;
  private readonly emitter = new EventEmitter();
  private readonly runSessions = new Map<string, string>();
  private readonly pendingApprovals = new Map<string, ApprovalRequest>();
  private cachedAgents: Agent[] = [];
  private cachedSessionCount = 0;
  private activeRunCount = 0;

  constructor(private readonly options: OpenClawAdapterOptions = {}) {}

  async connect(): Promise<void> {
    await this.disconnect();
    const endpoint = defaultGatewayEndpoint(this.options.gatewayUrl);
    const reachable = await probeTcp(endpoint.host, endpoint.port);
    if (!reachable) {
      this.connectionState = "disconnected";
      this.lastError = `No OpenClaw Gateway at ${endpoint.host}:${endpoint.port}`;
      throw new Error(this.lastError);
    }

    this.connectionState = "connecting";
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        const message = error.message || "Gateway connection failed";
        this.connectionState = message.toLowerCase().includes("pair")
          ? "authentication_required"
          : "error";
        this.lastError = message;
        reject(error);
      };

      this.client = new GatewayClient({
        url: endpoint.url.replace(/^http/, "ws"),
        token: this.options.token,
        bootstrapToken: this.options.token,
        clientName: GATEWAY_CLIENT_IDS.CLI,
        clientDisplayName: "Capsule",
        clientVersion: this.options.clientVersion ?? "0.1.0",
        platform: process.platform === "darwin" ? "macos" : process.platform,
        mode: GATEWAY_CLIENT_MODES.UI,
        role: "operator",
        scopes: CAPSULE_SCOPES,
        caps: CAPSULE_CAPS,
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        onHelloOk: (hello) => {
          this.hello = hello;
          this.connectionState = "connected";
          this.lastError = undefined;
          if (!settled) {
            settled = true;
            resolve();
          }
        },
        onEvent: (event) => this.handleEvent(event),
        onConnectError: (error) => fail(error),
        onClose: (_code, reason) => {
          if (this.connectionState === "connecting") {
            fail(new Error(reason || "Gateway closed during handshake"));
            return;
          }
          this.connectionState = "disconnected";
        },
      });
      this.client.start();
    });

    try {
      await this.refreshSnapshot();
    } catch {
      // Snapshot refresh is best-effort after a successful hello-ok.
    }
  }

  async disconnect(): Promise<void> {
    const current = this.client;
    this.client = undefined;
    this.hello = undefined;
    this.connectionState = "disconnected";
    if (current) {
      try {
        await current.stopAndWait({ timeoutMs: 1500 });
      } catch {
        current.stop();
      }
    }
  }

  async getStatus(): Promise<RuntimeStatus> {
    const endpoint = defaultGatewayEndpoint(this.options.gatewayUrl);
    const parsed = parseGatewayUrl(endpoint.url);
    return {
      state: this.connectionState,
      kind: "openclaw",
      gatewayUrl: endpoint.url,
      gatewayHost: parsed.host,
      gatewayPort: parsed.port,
      openclawVersion: asOptionalString(asRecord(this.hello?.server).version),
      protocol: this.hello?.protocol,
      methods: this.hello?.features?.methods,
      agentCount: this.cachedAgents.length,
      sessionCount: this.cachedSessionCount,
      activeRunCount: this.activeRunCount,
      error: this.lastError,
      lastConnectedAt: this.connectionState === "connected" ? nowIso() : undefined,
    };
  }

  async listAgents(): Promise<Agent[]> {
    const payload = await this.request<{ agents?: unknown[]; entries?: unknown[] }>(
      "agents.list",
      {},
    );
    const rows = payload.agents ?? payload.entries ?? [];
    this.cachedAgents = rows.map((row) => this.mapAgent(row));
    return this.cachedAgents;
  }

  async listSkills(): Promise<Skill[]> {
    try {
      const payload = await this.request<{ plugins?: unknown[]; skills?: unknown[] }>(
        "plugins.list",
        {},
      );
      const rows = payload.skills ?? payload.plugins ?? [];
      return rows.map((row) => this.mapSkill(row));
    } catch {
      return [];
    }
  }

  async listChannels(): Promise<ChannelBinding[]> {
    try {
      const payload = await this.request<{ channels?: unknown[] }>("channels.status", {});
      return (payload.channels ?? []).map((row) => this.mapChannelBinding(row));
    } catch {
      return [];
    }
  }

  async createSession(input: CreateSessionInputRuntime): Promise<Session> {
    const payload = await this.request<{
      key?: string;
      sessionKey?: string;
      id?: string;
      runStarted?: boolean;
    }>("sessions.create", {
      agentId: input.agentId,
      label: input.title,
      message: undefined,
    });
    const key = payload.sessionKey ?? payload.key ?? payload.id ?? createId("oc");
    const timestamp = nowIso();
    return {
      id: createId("sess"),
      workspaceId: "local",
      projectId: input.projectId,
      agentId: input.agentId ?? "main",
      title: input.title ?? "Conversation",
      mode: input.mode ?? "chat",
      state: "active",
      openclawSessionKey: key,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  async sendMessage(input: AgentMessage): Promise<Run> {
    const sessionKey = input.sessionId;
    const idempotencyKey = createId("idemp");
    const payload = await this.request<{ runId?: string; id?: string; status?: string }>(
      "sessions.send",
      {
        key: sessionKey,
        sessionKey,
        message: input.content,
        agentId: input.agentId,
        idempotencyKey,
      },
    );
    const openclawRunId = payload.runId ?? payload.id ?? createId("ocrun");
    const timestamp = nowIso();
    const run: Run = {
      id: createId("run"),
      sessionId: input.sessionId,
      projectId: "unknown",
      agentId: input.agentId ?? "main",
      skillId: input.skillId,
      status: "running",
      prompt: input.content,
      openclawRunId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.runSessions.set(openclawRunId, run.id);
    this.activeRunCount += 1;
    try {
      await this.request("sessions.messages.subscribe", {
        key: sessionKey,
        sessionKey,
        includeApprovals: true,
      });
    } catch {
      // Older gateways may not support this subscribe method.
    }
    return run;
  }

  async cancelRun(runId: string): Promise<void> {
    const openclawRunId =
      [...this.runSessions.entries()].find(([, capsuleId]) => capsuleId === runId)?.[0] ?? runId;
    await this.request("sessions.abort", { runId: openclawRunId });
    this.activeRunCount = Math.max(0, this.activeRunCount - 1);
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
    await this.request("exec.approval.resolve", {
      id: approvalId,
      decision:
        decision === "denied" ? "deny" : decision === "approved_session" ? "allow-always" : "allow-once",
    });
    this.pendingApprovals.delete(approvalId);
  }

  async listApprovals(): Promise<ApprovalRequest[]> {
    try {
      const payload = await this.request<{ approvals?: unknown[] }>("exec.approval.list", {});
      return (payload.approvals ?? []).map((row) => this.mapApproval(row));
    } catch {
      return [...this.pendingApprovals.values()];
    }
  }

  private async refreshSnapshot(): Promise<void> {
    try {
      this.cachedAgents = await this.listAgents();
    } catch {
      this.cachedAgents = [];
    }
    try {
      const sessions = await this.request<{ sessions?: unknown[] }>("sessions.list", {});
      this.cachedSessionCount = sessions.sessions?.length ?? 0;
      this.activeRunCount = (sessions.sessions ?? []).filter((row) => {
        const record = asRecord(row);
        return Boolean(record.hasActiveRun);
      }).length;
    } catch {
      this.cachedSessionCount = 0;
    }
  }

  private async request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.client) throw new Error("OpenClaw Gateway is not connected");
    return this.client.request<T>(method, params);
  }

  private handleEvent(event: EventFrame): void {
    const payload = asRecord(event.payload);
    const openclawRunId = asString(payload.runId, asString(payload.id));
    const runId = this.runSessions.get(openclawRunId) ?? openclawRunId;
    if (event.event === "exec.approval.requested" || event.event === "plugin.approval.requested") {
      const approval = this.mapApproval(payload);
      this.pendingApprovals.set(approval.id, approval);
      this.emit(runId || approval.runId, "approval.requested", "Approval required", {
        approval,
        status: "approval_required",
      });
      return;
    }
    if (event.event === "agent") {
      const stream = asString(payload.stream, asString(payload.phase, "lifecycle"));
      const text = asString(
        payload.text,
        asString(payload.message, asString(payload.summary, stream)),
      );
      const status = asString(payload.status);
      if (status === "ok" || payload.phase === "end") {
        this.activeRunCount = Math.max(0, this.activeRunCount - 1);
        this.emit(runId, "lifecycle", text || "Run completed", {
          status: "completed",
          output: text,
        });
        return;
      }
      if (status === "error" || payload.phase === "error") {
        this.activeRunCount = Math.max(0, this.activeRunCount - 1);
        this.emit(runId, "lifecycle", text || "Run failed", {
          status: "failed",
          error: text,
        });
        return;
      }
      this.emit(runId, stream.startsWith("tool") ? "tool" : "assistant", text, payload);
    }
  }

  private emit(runId: string, type: string, message: string, data?: Record<string, unknown>): void {
    if (!runId) return;
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

  private mapAgent(row: unknown): Agent {
    const record = asRecord(row);
    const id = asString(record.id, asString(record.agentId, createId("agent")));
    return {
      id,
      name: asString(record.name, asString(record.label, id)),
      description: asString(record.description, "OpenClaw agent"),
      runtime: "openclaw",
      model: asOptionalString(record.model) ?? asOptionalString(asRecord(record.model).id),
      workspace: asOptionalString(record.workspace),
      skills: Array.isArray(record.skills) ? record.skills.map(String) : [],
      tools: Array.isArray(record.tools) ? record.tools.map(String) : [],
      permissions: {},
      status: record.hasActiveRun ? "running" : "idle",
      kind: record.kind === "system" ? "system" : "agent",
      recentRunIds: [],
    };
  }

  private mapSkill(row: unknown): Skill {
    const record = asRecord(row);
    const id = asString(record.id, asString(record.pluginId, createId("skill")));
    return {
      id,
      name: asString(record.name, id),
      version: asString(record.version, "0.0.0"),
      description: asString(record.description, ""),
      source: asString(record.source, "openclaw"),
      status: record.enabled === false ? "disabled" : "installed",
      requirements: [],
      permissions: {},
      validation: "unvalidated",
    };
  }

  private mapChannelBinding(row: unknown): ChannelBinding {
    const record = asRecord(row);
    const id = asString(record.id, asString(record.channel, "channel"));
    return {
      id,
      channel: mapChannel(id),
      channelId: asString(record.accountId, id),
      displayName: asString(record.name, id),
      room: asOptionalString(record.room),
      thread: asOptionalString(record.thread),
      status: record.connected === false ? "disconnected" : "connected",
    };
  }

  private mapApproval(row: unknown): ApprovalRequest {
    const record = asRecord(row);
    return {
      id: asString(record.id, createId("apr")),
      runId: asString(record.runId, ""),
      agentId: asString(record.agentId, "main"),
      agentName: asString(record.agentName, "Agent"),
      action: asString(record.action, asString(record.command, "Execute")),
      target: asString(record.target, asString(record.command, "")),
      reason: asString(record.reason, "OpenClaw requested host execution approval."),
      status: "pending",
      createdAt: nowIso(),
    };
  }
}
