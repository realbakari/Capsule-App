import type { HarnessPermissionProfile } from "./harness.js";
import type {
  Agent,
  AgentMessage,
  AgentMode,
  ApprovalRequest,
  ChannelBinding,
  CreateSessionInput,
  MockScenario,
  Run,
  RunEvent,
  RuntimeStatus,
  Session,
  Skill,
  Unsubscribe,
} from "./types.js";

export type RunEventHandler = (event: RunEvent) => void;

export interface CreateSessionInputRuntime extends CreateSessionInput {
  projectId: string;
}

export interface AgentRuntime {
  readonly kind: "openclaw" | "mock";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<RuntimeStatus>;
  listAgents(): Promise<Agent[]>;
  listSkills(): Promise<Skill[]>;
  listChannels(): Promise<ChannelBinding[]>;
  createSession(input: CreateSessionInputRuntime): Promise<Session>;
  sendMessage(input: AgentMessage): Promise<Run>;
  cancelRun(runId: string): Promise<void>;
  subscribeToRun(runId: string, handler: RunEventHandler): Unsubscribe;
  resolveApproval?(
    approvalId: string,
    decision: "approved_once" | "approved_session" | "denied",
  ): Promise<void>;
  listApprovals?(): Promise<ApprovalRequest[]>;
}

export type ComposerSendKey = "enter" | "cmd-enter";

export const TOKEN_PRESENT_MASK = "••••";

export const DEFAULT_CAPSULE_SETTINGS: CapsuleSettings = {
  gatewayUrl: "ws://127.0.0.1:18789",
  useMockWhenOffline: true,
  launchAtLogin: false,
  mockScenario: "successful_run",
  composerSendKey: "enter",
  defaultMode: "chat",
  defaultPermission: "default",
};

export interface CapsuleSettings {
  gatewayUrl: string;
  gatewayToken?: string;
  useMockWhenOffline: boolean;
  launchAtLogin: boolean;
  mockScenario: MockScenario;
  composerSendKey: ComposerSendKey;
  defaultMode: AgentMode;
  defaultPermission: HarnessPermissionProfile;
  defaultAgentId?: string;
}

const AGENT_MODES: AgentMode[] = [
  "chat",
  "agent",
  "plan",
  "code",
  "research",
  "browser",
  "automation",
];
const SEND_KEYS: ComposerSendKey[] = ["enter", "cmd-enter"];
const PERMISSIONS: HarnessPermissionProfile[] = ["default", "strict", "approve-all"];
const SCENARIOS: MockScenario[] = [
  "successful_run",
  "failed_run",
  "approval_required",
  "verification_failure",
  "multi_agent",
  "long_running",
  "disconnected_gateway",
  "buzz_message",
  "tool_failure",
];

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function normalizeCapsuleSettings(input: Partial<CapsuleSettings> = {}): CapsuleSettings {
  const gatewayUrl = input.gatewayUrl?.trim() || DEFAULT_CAPSULE_SETTINGS.gatewayUrl;
  const defaultAgentId = input.defaultAgentId?.trim();
  return {
    gatewayUrl,
    gatewayToken: input.gatewayToken,
    useMockWhenOffline: Boolean(
      input.useMockWhenOffline ?? DEFAULT_CAPSULE_SETTINGS.useMockWhenOffline,
    ),
    launchAtLogin: Boolean(input.launchAtLogin),
    mockScenario: pick(input.mockScenario, SCENARIOS, DEFAULT_CAPSULE_SETTINGS.mockScenario),
    composerSendKey: pick(
      input.composerSendKey,
      SEND_KEYS,
      DEFAULT_CAPSULE_SETTINGS.composerSendKey,
    ),
    defaultMode: pick(input.defaultMode, AGENT_MODES, DEFAULT_CAPSULE_SETTINGS.defaultMode),
    defaultPermission: pick(
      input.defaultPermission,
      PERMISSIONS,
      DEFAULT_CAPSULE_SETTINGS.defaultPermission,
    ),
    defaultAgentId: defaultAgentId || undefined,
  };
}
