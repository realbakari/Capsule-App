import { EventEmitter } from "node:events";
import { GatewayClient, GatewayClientRequestError } from "@openclaw/gateway-client";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
} from "@openclaw/gateway-protocol/client-info";
import { classifyGatewayConnectFailure } from "@openclaw/gateway-protocol/connect-error-details";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import type { EventFrame, HelloOk } from "@openclaw/gateway-protocol/frame-guards";
import {
  acpDoctorCommand,
  acpOptionCommand,
  acpxPermissionMode,
  acpSpawnCommand,
  acpStatusCommand,
  createId,
  gatewaySessionLabel,
  isAcpSessionKey,
  nowIso,
  parseAcpStatus,
  type Agent,
  type AgentMessage,
  type AgentRuntime,
  type ApprovalRequest,
  type ChannelBinding,
  type ChannelName,
  type ConnectionState,
  type CreateSessionInputRuntime,
  type HarnessId,
  type HarnessPermissionProfile,
  type HarnessOptionKey,
  type Run,
  type RunEvent,
  type RunEventHandler,
  type RuntimeStatus,
  type Session,
  type Skill,
  type Unsubscribe,
} from "@capsule/shared";
import {
  pickGatewayAgentId,
  resolveGatewayAgentMap,
  sessionKeyIsConfigured,
  type GatewayAgentMap,
} from "./agent-map.js";
import { createGatewayHostDeps } from "./device-identity.js";
import {
  defaultGatewayEndpoint,
  parseGatewayUrl,
  probeTcp,
  readLocalGatewayBootstrapToken,
} from "./discovery.js";
import {
  acpxAgentPatch,
  acpxPermissionPatch,
  isAcpPermissionRequestEvent,
  readAcpAllowedAgents,
  readAcpPermissionRequest,
  readAcpxAgentCommand,
  readAcpxHarnessPolicy,
  resolveAcpxEnabled,
  type AcpxAgentCommand,
  type AcpxHarnessPolicy,
} from "./plugins.js";
import {
  acpCommandFailed,
  asRecord,
  asString,
  classifyAgentStream,
  classifyRuntimeEvent,
  compactParams,
  explainAcpFailure,
  isAcpFailureText,
  extractAcpSessionKey,
  extractGatewayText,
  isRuntimeFrame,
  isAssistantProse,
  isGatewayAgentFailure,
  isGatewayTurnDone,
} from "./events.js";

const CAPSULE_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.admin",
];
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
  identityDir?: string;
}

function describeConnectError(error: unknown): Error {
  const err = error instanceof Error ? error : new Error(String(error));
  const details = error instanceof GatewayClientRequestError ? error.details : undefined;
  const classified = classifyGatewayConnectFailure({
    details,
    message: err.message,
  });
  const text = classified.remediation
    ? `${classified.userMessage}\n${classified.remediation}`
    : classified.userMessage;
  if (!text || text === err.message) return err;
  const wrapped = new Error(text);
  wrapped.cause = err;
  return wrapped;
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
  /** Last Capsule run for a Gateway session key — used when an approval has no runId. */
  private readonly sessionRuns = new Map<string, string>();
  private readonly pendingApprovals = new Map<string, ApprovalRequest>();
  /**
   * Slash-command replies are useful to the control call that requested them,
   * but they are not agent output and must not be added to a conversation.
   *
   * The entry is installed before sending the command so a fast Gateway reply
   * cannot win the race with the reply listener.
   */
  private readonly pendingAcpControls = new Map<string, number>();
  private cachedAgents: Agent[] = [];
  private cachedSessionCount = 0;
  private activeRunCount = 0;
  private agentMap: GatewayAgentMap = { defaultId: "main", configuredIds: ["main"] };

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
    const token = this.options.token ?? readLocalGatewayBootstrapToken(endpoint.host);
    const hostDeps = createGatewayHostDeps(this.options.identityDir);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        const wrapped = describeConnectError(error);
        const message = wrapped.message || "Gateway connection failed";
        this.connectionState =
          message.toLowerCase().includes("pair") || message.toLowerCase().includes("device identity")
            ? "authentication_required"
            : "error";
        this.lastError = message;
        reject(wrapped);
      };

      this.client = new GatewayClient({
        url: endpoint.url.replace(/^http/, "ws"),
        token,
        bootstrapToken: token,
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
        hostDeps,
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
      await this.refreshAgentMap();
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
    const mapped = rows.map((row) => this.mapAgent(row));
    this.cachedAgents = mapped.filter((agent) => this.agentMap.configuredIds.includes(agent.id));
    if (!this.cachedAgents.some((agent) => agent.id === this.agentMap.defaultId)) {
      this.cachedAgents.unshift({
        id: this.agentMap.defaultId,
        name: "Main",
        description: "OpenClaw default agent",
        runtime: "openclaw",
        model: "default",
        skills: [],
        tools: [],
        permissions: {},
        status: "idle",
        kind: "agent",
        recentRunIds: [],
      });
    }
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

  async hasAcpxPlugin(): Promise<boolean> {
    const [health, config, pluginsList] = await Promise.all([
      this.request("health", {}).catch(() => undefined),
      this.request("config.get", {}).catch(() => undefined),
      this.request("plugins.list", {}).catch(() => undefined),
    ]);
    return resolveAcpxEnabled({ health, config, pluginsList });
  }

  async readAcpxHarnessPolicy(): Promise<AcpxHarnessPolicy> {
    const config = await this.request("config.get", {}).catch(() => undefined);
    return readAcpxHarnessPolicy(config);
  }

  /**
   * Registers a CLI's native ACP stdio command with acpx. This is needed for
   * first-class harnesses such as Grok Build that are valid ACP agents but are
   * not bundled aliases in every OpenClaw/acpx release.
   */
  async ensureAcpxAgentCommand(
    agentId: string,
    requested: AcpxAgentCommand,
  ): Promise<{ already: boolean; applied: boolean; error?: string }> {
    let config: unknown;
    try {
      config = await this.request("config.get", {});
    } catch (error) {
      return {
        already: false,
        applied: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const current = readAcpxAgentCommand(config, agentId);
    const allowedAgents = readAcpAllowedAgents(config);
    const commandMatches =
      current?.command === requested.command &&
      JSON.stringify(current.args ?? []) === JSON.stringify(requested.args ?? []);
    const allowlistMatches = allowedAgents === undefined || allowedAgents.includes(agentId);
    if (commandMatches && allowlistMatches) return { already: true, applied: false };

    const pluginId = current?.pluginId ?? readAcpxHarnessPolicy(config).pluginId ?? "acpx";
    const definition = {
      command: requested.command,
      ...(requested.args ? { args: requested.args } : {}),
    };
    const patch = acpxAgentPatch(pluginId, agentId, definition, allowedAgents);
    const path = `plugins.entries.${pluginId}.config.agents.${agentId}`;
    const attempts: Array<{ method: string; params: unknown }> = [
      { method: "config.patch", params: patch },
      { method: "config.patch", params: { patch } },
      { method: "config.set", params: { path, value: definition } },
      { method: "config.set", params: { key: path, value: definition } },
    ];
    let lastError: string | undefined;
    for (const attempt of attempts) {
      try {
        await this.request(attempt.method, attempt.params);
        if (
          attempt.method === "config.set" &&
          allowedAgents &&
          !allowedAgents.includes(agentId)
        ) {
          const value = [...new Set([...allowedAgents, agentId])];
          try {
            await this.request("config.set", { path: "acp.allowedAgents", value });
          } catch {
            await this.request("config.set", { key: "acp.allowedAgents", value });
          }
        }
        return { already: false, applied: true };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return { already: false, applied: false, error: lastError };
  }

  /**
   * Plugin config is the real acpx switch. Standard/Full → approve-all,
   * Supervised → deny-all. A Gateway restart may still be required for
   * already-running acpx workers.
   */
  async ensureAcpxPermissionMode(mode: "approve-all" | "deny-all"): Promise<{
    already: boolean;
    applied: boolean;
    error?: string;
  }> {
    let policy: AcpxHarnessPolicy = {};
    try {
      policy = await this.readAcpxHarnessPolicy();
    } catch (error) {
      return { already: false, applied: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (policy.permissionMode === mode) return { already: true, applied: false };
    const pluginId = policy.pluginId ?? "acpx";
    const patch = acpxPermissionPatch(pluginId, mode);
    const path = `plugins.entries.${pluginId}.config.permissionMode`;
    const attempts: Array<{ method: string; params: unknown }> = [
      { method: "config.patch", params: patch },
      { method: "config.patch", params: { patch } },
      { method: "config.set", params: { path, value: mode } },
      { method: "config.set", params: { key: path, value: mode } },
    ];
    let lastError: string | undefined;
    for (const attempt of attempts) {
      try {
        await this.request(attempt.method, attempt.params);
        const nip = `plugins.entries.${pluginId}.config.nonInteractivePermissions`;
        await this.request("config.set", { path: nip, value: "deny" }).catch(() => undefined);
        await this.request("config.set", { key: nip, value: "deny" }).catch(() => undefined);
        return { already: false, applied: true };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return { already: false, applied: false, error: lastError };
  }

  async ensureAcpxHeadlessWrites(): Promise<{
    already: boolean;
    applied: boolean;
    error?: string;
  }> {
    return this.ensureAcpxPermissionMode("approve-all");
  }

  async spawnAcpSession(input: {
    harnessId: HarnessId;
    cwd?: string;
    title?: string;
    prompt?: string;
    mode?: "persistent" | "oneshot";
    sessionKey?: string;
    permissionProfile?: string;
    model?: string;
  }): Promise<{ sessionKey: string; usedSlashCommand: boolean; command: string }> {
    let parentKey = input.sessionKey;
    if (!parentKey || parentKey.startsWith("mock:") || isAcpSessionKey(parentKey)) {
      parentKey = await this.createGatewaySession({
        /*
         * The carrier label is a unique key on the Gateway and a conversation
         * title is not, so gatewaySessionLabel suffixes it with an id. It has
         * to be a fresh one every time we come through here. Suffixing with
         * the incoming session key looked stable and was: a thread whose ACP
         * session had died came back with the same dead key, asked for the
         * same label as the carrier it made the first time, and the Gateway
         * rejected it with "label already in use".
         */
        label: gatewaySessionLabel(input.title ?? input.harnessId, createId(input.harnessId)),
        cwd: input.cwd,
      });
    }
    await this.subscribeSession(parentKey);
    const mapped = acpxPermissionMode(input.permissionProfile);
    await this.ensureAcpxPermissionMode(mapped).catch(() => undefined);
    const spawned = await this.spawnAcpOnParent(parentKey, input);
    const acpKey = extractAcpSessionKey(spawned.text);
    if (!acpKey) {
      throw new Error(
        spawned.text?.trim() ||
          `OpenClaw did not start ${input.harnessId} through acpx. Capsule will not send this to the default Gateway agent.`,
      );
    }
    await this.subscribeSession(acpKey);
    // Always send a mode: leaving it unset is what left acpx on the setting
    // that kills a turn as soon as the agent wants to write or run something.
    await this.setAcpOption(acpKey, "permissions", mapped);
    if (input.model) {
      await this.setAcpOption(acpKey, "model", input.model);
    }
    if (input.prompt) {
      await this.sendSlash(acpKey, input.prompt);
    }
    return { sessionKey: acpKey, usedSlashCommand: true, command: spawned.command };
  }

  private async spawnAcpOnParent(
    parentKey: string,
    input: {
      harnessId: HarnessId;
      cwd?: string;
      title?: string;
      mode?: "persistent" | "oneshot";
    },
  ): Promise<{ command: string; text?: string }> {
    const command = acpSpawnCommand(input.harnessId, {
      cwd: input.cwd,
      mode: input.mode ?? "persistent",
      bind: "off",
      label: input.title,
    });
    const spawned = await this.acpCommand(parentKey, command, { waitMs: 20_000 });
    const failed = acpCommandFailed(spawned.text);
    if (failed) throw new Error(failed);
    return spawned;
  }

  async ensureOperatorSession(input: {
    sessionKey?: string;
    label?: string;
    cwd?: string;
    requestedAgentId?: string;
  }): Promise<string> {
    if (input.sessionKey && isAcpSessionKey(input.sessionKey)) return input.sessionKey;
    if (sessionKeyIsConfigured(input.sessionKey, this.agentMap)) return input.sessionKey!;
    return this.createGatewaySession({
      label: input.label,
      cwd: input.cwd,
      agentId: pickGatewayAgentId(input.requestedAgentId, this.agentMap),
    });
  }

  /*
   * The permission mode used to be sent only at spawn, so a session created
   * before the mode was correct kept the old one forever — ensureHarnessSession
   * reuses a live session rather than respawning it. Applying it once per
   * process for each session key repairs those without forcing anyone to close
   * and recreate a conversation.
   */
  private readonly permissionModeApplied = new Set<string>();

  private async ensureAcpPermissionMode(
    sessionKey: string,
    profile: HarnessPermissionProfile | undefined,
  ): Promise<void> {
    if (!isAcpSessionKey(sessionKey)) return;
    const mode = acpxPermissionMode(profile);
    const stamp = `${sessionKey}:${mode}`;
    if (this.permissionModeApplied.has(stamp)) return;
    try {
      await this.setAcpOption(sessionKey, "permissions", mode);
      this.permissionModeApplied.add(stamp);
    } catch {
      // A gateway that does not accept the option should not block the turn;
      // the spawn path still sets it for newly created sessions.
    }
  }

  private async createGatewaySession(input: { label?: string; cwd?: string; agentId?: string }): Promise<string> {
    const attempt = async (params: Record<string, unknown>) => {
      const created = await this.request<{ key?: string; sessionKey?: string; id?: string }>(
        "sessions.create",
        compactParams(params),
      );
      const key = created.key ?? created.sessionKey ?? created.id;
      if (!key) throw new Error("sessions.create did not return a session key");
      return key;
    };
    const agentId = pickGatewayAgentId(input.agentId, this.agentMap);
    try {
      return await attempt({
        label: input.label,
        cwd: input.cwd,
        agentId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/label already in use/i.test(message)) {
        return attempt({ agentId, cwd: input.cwd });
      }
      return attempt({ label: input.label, agentId: this.agentMap.defaultId });
    }
  }

  private async subscribeSession(sessionKey: string): Promise<void> {
    try {
      await this.request("sessions.messages.subscribe", {
        key: sessionKey,
        includeApprovals: true,
      });
    } catch {
      // Older gateways may not support this subscribe method.
    }
  }

  async sendSlash(sessionKey: string, message: string): Promise<void> {
    await this.request("sessions.send", {
      key: sessionKey,
      message,
      idempotencyKey: createId("idemp"),
    });
  }

  async acpCommand(
    sessionKey: string,
    command: string,
    options: { waitMs?: number } = {},
  ): Promise<{ command: string; text?: string }> {
    this.beginAcpControl(sessionKey);
    const reply = this.waitForReply(sessionKey, options.waitMs ?? 8_000);
    try {
      await this.sendSlash(sessionKey, command);
      const text = await reply;
      const failed = acpCommandFailed(text);
      if (failed) throw new Error(failed);
      return { command, text };
    } catch (error) {
      // If sessions.send itself failed, the waiter still needs to clean up its
      // listener and timer, but it must not turn the send error into an
      // unhandled rejection.
      void reply.catch(() => undefined);
      throw error;
    } finally {
      this.endAcpControl(sessionKey);
    }
  }

  async cancelAcp(sessionKey: string, runId?: string): Promise<void> {
    let abortError: unknown;
    try {
      await this.request("sessions.abort", compactParams({ key: sessionKey, runId }));
    } catch (error) {
      abortError = error;
    }
    try {
      // sessions.abort stops the Gateway run. The ACP harness has its own
      // in-flight prompt, so it must always receive its lifecycle cancel too.
      await this.acpCommand(sessionKey, "/acp cancel", { waitMs: 12_000 });
    } catch (cancelError) {
      const abortDetail = abortError instanceof Error ? ` Gateway abort also failed: ${abortError.message}` : "";
      const detail = cancelError instanceof Error ? cancelError.message : String(cancelError);
      throw new Error(`ACP cancellation was not confirmed: ${detail}.${abortDetail}`);
    }
  }

  async steerAcp(sessionKey: string, instruction: string): Promise<void> {
    try {
      await this.request("sessions.steer", { key: sessionKey, message: instruction });
    } catch {
      await this.sendSlash(sessionKey, `/acp steer ${instruction}`);
    }
  }

  async closeAcp(sessionKey: string): Promise<void> {
    await this.acpCommand(sessionKey, "/acp close", { waitMs: 12_000 });
  }

  async doctorAcp(sessionKey: string): Promise<string> {
    await this.subscribeSession(sessionKey);
    const result = await this.acpCommand(sessionKey, acpDoctorCommand(), { waitMs: 12_000 });
    return result.text ?? "";
  }

  async statusAcp(sessionKey: string): Promise<{ text: string; parsed: ReturnType<typeof parseAcpStatus> }> {
    const result = await this.acpCommand(sessionKey, acpStatusCommand(), { waitMs: 8_000 });
    const text = result.text ?? "";
    return { text, parsed: parseAcpStatus(text) };
  }

  /*
   * Option commands are Gateway slash commands, not agent prompts. Sending one
   * into an ACP-bound session hands it to the agent as text and the Gateway's
   * parser never sees it — which is why `/acp permissions` was silently inert.
   * Route it through a plain Gateway session and name the ACP session as the
   * target instead.
   */
  async setAcpOption(sessionKey: string, key: HarnessOptionKey, value: string): Promise<string> {
    const acpTarget = isAcpSessionKey(sessionKey) ? sessionKey : undefined;
    const controlKey = acpTarget ? await this.controlSessionKey() : sessionKey;
    const result = await this.acpCommand(controlKey, acpOptionCommand(key, value, acpTarget), {
      waitMs: 6_000,
    });
    return result.text ?? "";
  }

  /** A plain Gateway session kept for issuing ACP control commands. */
  private controlKey?: string;

  private async controlSessionKey(): Promise<string> {
    if (this.controlKey) return this.controlKey;
    this.controlKey = await this.createGatewaySession({ label: "capsule-acp-control" });
    return this.controlKey;
  }

  async listAcpSessionKeys(): Promise<string[]> {
    try {
      const payload = await this.request<{ sessions?: unknown[] }>("sessions.list", {});
      return (payload.sessions ?? [])
        .map((row) => {
          const record = asRecord(row);
          return asString(record.key, asString(record.sessionKey, asString(record.id)));
        })
        .filter((key) => key.includes(":acp:") || key.includes("acp"));
    } catch {
      return [];
    }
  }

  async waitForReply(sessionKey: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];
      const timer = setTimeout(() => {
        this.emitter.off("acp-reply", onReply);
        if (chunks.length > 0) resolve(chunks.join("\n"));
        else reject(new Error("Timed out waiting for ACP reply"));
      }, timeoutMs);
      const onReply = (payload: { sessionKey?: string; text?: string; done?: boolean }) => {
        if (payload.sessionKey && payload.sessionKey !== sessionKey) return;
        if (payload.text) chunks.push(payload.text);
        if (payload.done) {
          clearTimeout(timer);
          this.emitter.off("acp-reply", onReply);
          resolve(chunks.join("\n"));
        }
      };
      this.emitter.on("acp-reply", onReply);
    });
  }

  async createSession(input: CreateSessionInputRuntime): Promise<Session> {
    const label = gatewaySessionLabel(input.title, input.projectId);
    const payload = await this.request<{
      key?: string;
      sessionKey?: string;
      id?: string;
      runStarted?: boolean;
    }>("sessions.create", compactParams({
      agentId: pickGatewayAgentId(input.agentId, this.agentMap),
      label,
    }));
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
    const sessionKey = await this.ensureOperatorSession({
      sessionKey: input.sessionId,
      requestedAgentId: input.agentId,
    });
    await this.ensureAcpPermissionMode(sessionKey, input.permissionProfile);
    const idempotencyKey = createId("idemp");
    const payload = await this.request<{ runId?: string; id?: string; status?: string }>(
      "sessions.send",
      compactParams({
        key: sessionKey,
        message: input.content,
        idempotencyKey,
      }),
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
    this.sessionRuns.set(sessionKey, run.id);
    this.activeRunCount += 1;
    try {
      await this.request("sessions.messages.subscribe", {
        key: sessionKey,
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
    const mapped =
      decision === "denied" ? "deny" : decision === "approved_session" ? "allow-always" : "allow-once";
    const outcome =
      decision === "denied" ? "reject_once" : decision === "approved_session" ? "allow_always" : "allow_once";
    const hyphen =
      decision === "denied" ? "reject-once" : decision === "approved_session" ? "allow-always" : "allow-once";
    const attempts: Array<{ method: string; params: Record<string, unknown> }> = [
      { method: "exec.approval.resolve", params: { id: approvalId, decision: mapped } },
      { method: "approvals.resolve", params: { id: approvalId, decision: mapped } },
      {
        method: "session.permission.resolve",
        params: { id: approvalId, requestId: approvalId, outcome },
      },
      {
        method: "session.permission.resolve",
        params: { requestId: approvalId, outcome: hyphen },
      },
    ];
    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        await this.request(attempt.method, attempt.params);
        this.pendingApprovals.delete(approvalId);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "approval resolve failed"));
  }

  async listApprovals(): Promise<ApprovalRequest[]> {
    try {
      const payload = await this.request<{ approvals?: unknown[] }>("exec.approval.list", {});
      return (payload.approvals ?? []).map((row) => this.mapApproval(row));
    } catch {
      return [...this.pendingApprovals.values()];
    }
  }

  private async refreshAgentMap(): Promise<void> {
    const [agentsList, config, status] = await Promise.all([
      this.request("agents.list", {}).catch(() => undefined),
      this.request("config.get", {}).catch(() => undefined),
      this.request("status", {}).catch(() => undefined),
    ]);
    this.agentMap = resolveGatewayAgentMap({ agentsList, config, status });
  }

  private async refreshSnapshot(): Promise<void> {
    try {
      await this.refreshAgentMap();
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

  onAcpReply(
    handler: (payload: { sessionKey?: string; text?: string; done?: boolean; control?: boolean }) => void,
  ): Unsubscribe {
    this.emitter.on("acp-reply", handler);
    return () => this.emitter.off("acp-reply", handler);
  }

  private handleEvent(event: EventFrame): void {
    const payload = asRecord(event.payload);
    const sessionKey = asOptionalString(payload.sessionKey) ?? asOptionalString(payload.key);
    const openclawRunId = asString(payload.runId);
    const payloadId = asString(payload.id);
    const runId =
      (openclawRunId ? this.runSessions.get(openclawRunId) : undefined) ??
      (payloadId ? this.runSessions.get(payloadId) : undefined) ??
      (sessionKey ? this.sessionRuns.get(sessionKey) : undefined) ??
      (openclawRunId || payloadId);
    /*
     * The reply is prose only. ACP runtime frames also carry text — "usage
     * updated: 87690/200000", "tool call (completed)" — and once that text was
     * being read out of the nested payload it started being concatenated into
     * the agent's answer. Activity frames still become run events; they just
     * must not contribute to the reply body.
     */
    const runtimeKind = classifyRuntimeEvent(payload);
    // A runtime frame is telemetry whether or not its eventType is one we
    // recognise. Treating "unrecognised" as prose is what let "usage updated:
    // 87690/200000" and "tool call (completed):" into the agent's reply.
    const isProseFrame =
      !isRuntimeFrame(payload) && (runtimeKind === undefined || runtimeKind === "message");
    // frameText is every frame's own text, for the activity log. text is the
    // subset that belongs in the agent's answer.
    const frameText = extractGatewayText(payload);
    // A protocol failure is not the agent speaking, however prose-shaped its
    // frame is. It reaches the user through the error path instead.
    const text = isProseFrame && !isAcpFailureText(frameText) ? frameText : "";
    const control = sessionKey ? this.pendingAcpControls.has(sessionKey) : false;
    if (sessionKey && text) {
      this.emitter.emit("acp-reply", {
        sessionKey,
        text,
        done: isGatewayTurnDone(payload),
        control,
      });
    } else if (sessionKey && isGatewayTurnDone(payload)) {
      this.emitter.emit("acp-reply", {
        sessionKey,
        text: text || undefined,
        done: true,
        control,
      });
    }
    if (
      event.event === "exec.approval.requested" ||
      event.event === "plugin.approval.requested" ||
      isAcpPermissionRequestEvent(event.event, payload)
    ) {
      const approval = this.mapApproval(payload, runId, sessionKey);
      this.pendingApprovals.set(approval.id, approval);
      this.emit(approval.runId || runId, "approval.requested", "Approval required", {
        approval,
        status: "approval_required",
      });
      return;
    }
    // Run events describe what happened, so they keep the frame's own text
    // even when it is activity rather than prose.
    const agentText = frameText || asString(payload.summary, asString(payload.errorMessage));
    if (runId && isGatewayAgentFailure(agentText)) {
      this.activeRunCount = Math.max(0, this.activeRunCount - 1);
      const explained = explainAcpFailure(agentText) ?? agentText;
      this.emit(runId, "lifecycle", explained, { status: "failed", error: explained });
      return;
    }
    if (event.event === "agent") {
      const stream = asString(payload.stream, asString(payload.phase, "lifecycle"));
      const status = asString(payload.status);
      if (status === "ok" || payload.phase === "end" || isGatewayTurnDone(payload)) {
        this.activeRunCount = Math.max(0, this.activeRunCount - 1);
        this.emit(runId, "lifecycle", agentText || "Run completed", {
          status: "completed",
          output: agentText,
        });
        return;
      }
      if (status === "error" || payload.phase === "error") {
        this.activeRunCount = Math.max(0, this.activeRunCount - 1);
        this.emit(runId, "lifecycle", agentText || "Run failed", {
          status: "failed",
          error: agentText,
        });
        return;
      }
      // An ACP runtime frame's real kind lives in its nested eventType; the
      // outer stream is always "acp".
      const kind = classifyRuntimeEvent(payload) ?? classifyAgentStream(stream);
      // "assistant" is the only type the engine folds into run.result, so
      // reasoning, plan text and command output must not use it.
      this.emit(runId, isAssistantProse(kind) ? "assistant" : kind, agentText, {
        ...payload,
        streamKind: kind,
      });
      return;
    }
    if (runId && isGatewayTurnDone(payload)) {
      this.activeRunCount = Math.max(0, this.activeRunCount - 1);
      this.emit(runId, "lifecycle", agentText || "Run completed", {
        status: "completed",
        output: agentText,
      });
    }
  }

  private beginAcpControl(sessionKey: string): void {
    this.pendingAcpControls.set(sessionKey, (this.pendingAcpControls.get(sessionKey) ?? 0) + 1);
  }

  private endAcpControl(sessionKey: string): void {
    const pending = this.pendingAcpControls.get(sessionKey) ?? 0;
    if (pending <= 1) this.pendingAcpControls.delete(sessionKey);
    else this.pendingAcpControls.set(sessionKey, pending - 1);
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

  private mapApproval(row: unknown, fallbackRunId = "", fallbackSessionKey?: string): ApprovalRequest {
    const record = asRecord(row);
    const fields = readAcpPermissionRequest(record);
    const tool = fields.tool ?? asString(record.tool);
    const runId =
      fields.runId ||
      fallbackRunId ||
      (fields.sessionKey ? this.sessionRuns.get(fields.sessionKey) : undefined) ||
      (fallbackSessionKey ? this.sessionRuns.get(fallbackSessionKey) : undefined) ||
      "";
    return {
      id: fields.id ?? asString(record.id, createId("apr")),
      runId,
      agentId: fields.agentId ?? asString(record.agentId, "main"),
      agentName: asString(record.agentName, "Agent"),
      action: fields.action ?? asString(record.action, asString(record.command, tool || "Execute")),
      target: asString(record.target, asString(record.command, fields.title ?? "")),
      reason: asString(
        record.reason,
        tool ? `ACP asked to ${tool}.` : "OpenClaw requested host execution approval.",
      ),
      status: "pending",
      createdAt: nowIso(),
    };
  }
}
