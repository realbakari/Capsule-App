import type {
  Agent,
  AgentMessage,
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

export interface CapsuleSettings {
  gatewayUrl: string;
  gatewayToken?: string;
  useMockWhenOffline: boolean;
  launchAtLogin: boolean;
  mockScenario: MockScenario;
}
