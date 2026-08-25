export type ConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "authentication_required"
  | "error";

export type RuntimeKind = "openclaw" | "mock";

export type AgentMode =
  | "chat"
  | "agent"
  | "plan"
  | "code"
  | "research"
  | "browser"
  | "automation";

export type AgentStatus = "idle" | "running" | "offline" | "error";

export type AgentKind = "agent" | "system";

export type RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "approval_required"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type PolicyDecisionKind = "allow" | "approval" | "block";

export type PolicyScope =
  | "workspace"
  | "project"
  | "agent"
  | "skill"
  | "task";

export type ChannelName =
  | "buzz"
  | "telegram"
  | "discord"
  | "slack"
  | "whatsapp"
  | "web"
  | "other";

export type MockScenario =
  | "successful_run"
  | "failed_run"
  | "approval_required"
  | "verification_failure"
  | "multi_agent"
  | "long_running"
  | "disconnected_gateway"
  | "buzz_message"
  | "tool_failure";

export interface RuntimeStatus {
  state: ConnectionState;
  kind: RuntimeKind;
  gatewayUrl: string;
  gatewayHost: string;
  gatewayPort: number;
  openclawVersion?: string;
  protocol?: number;
  methods?: string[];
  agentCount: number;
  sessionCount: number;
  activeRunCount: number;
  error?: string;
  lastConnectedAt?: string;
}

export interface SubsystemStatus {
  capsuleCore: ConnectionState;
  openclawGateway: ConnectionState;
  buzz: ConnectionState;
  database: ConnectionState;
  keychain: ConnectionState;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  runtime: RuntimeKind;
  model?: string;
  workspace?: string;
  skills: string[];
  tools: string[];
  permissions: Record<string, PolicyDecisionKind>;
  status: AgentStatus;
  kind: AgentKind;
  recentRunIds: string[];
}

export interface Skill {
  id: string;
  name: string;
  version: string;
  description: string;
  source: string;
  status: "installed" | "disabled" | "invalid" | "available";
  requirements: string[];
  permissions: Record<string, PolicyDecisionKind>;
  validation?: "passed" | "failed" | "unvalidated";
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  workingDirectory?: string;
  defaultAgentId?: string;
  defaultSkillIds: string[];
  defaultMode: AgentMode;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  workspaceId: string;
  projectId: string;
  agentId: string;
  title: string;
  mode: AgentMode;
  state: "active" | "archived";
  openclawSessionKey?: string;
  harnessId?: import("./harness.js").HarnessId;
  harnessState?: import("./harness.js").HarnessSessionState;
  acpMode?: import("./harness.js").AcpMode;
  permissionProfile?: string;
  modelOverride?: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  workingDirectory?: string | null;
  defaultAgentId?: string | null;
  defaultMode?: AgentMode;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface GitStatus {
  available: boolean;
  isRepo: boolean;
  branch?: string;
  dirty: boolean;
  changed: number;
  summary: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  runId?: string;
  createdAt: string;
}

export interface ContractRequirement {
  id: string;
  description: string;
  kind: "tests_pass" | "files_exist" | "output_contains" | "custom";
  value?: string;
}

export interface ContractForbidden {
  id: string;
  description: string;
  kind: "path" | "action" | "custom";
  value?: string;
}

export interface ExecutionContract {
  id: string;
  runId?: string;
  required: ContractRequirement[];
  forbidden: ContractForbidden[];
  humanSummary: string;
}

export interface PolicyRule {
  id: string;
  scope: PolicyScope;
  scopeId?: string;
  resource: "filesystem" | "terminal" | "network" | "git";
  action: string;
  decision: PolicyDecisionKind;
}

export interface PolicyDecision {
  id: string;
  runId: string;
  ruleId?: string;
  resource: string;
  action: string;
  target: string;
  decision: PolicyDecisionKind;
  reason: string;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  action: string;
  target: string;
  reason: string;
  status: "pending" | "approved_once" | "approved_session" | "denied";
  createdAt: string;
  resolvedAt?: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  timestamp: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface ProgressStep {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "error";
}

export interface Artifact {
  id: string;
  workspaceId: string;
  projectId: string;
  sessionId: string;
  runId: string;
  agentId: string;
  kind: "file" | "patch" | "report" | "image" | "document" | "dataset" | "research" | "link" | "text";
  title: string;
  path?: string;
  mimeType?: string;
  content?: string;
  createdAt: string;
}

export interface VerificationResult {
  id: string;
  runId: string;
  passed: boolean;
  summary: string;
  checks: Array<{
    requirementId: string;
    description: string;
    passed: boolean;
    detail?: string;
  }>;
  createdAt: string;
}

export interface EvaluationResult {
  id: string;
  runId: string;
  summary: string;
  score?: number;
  createdAt: string;
}

export interface Run {
  id: string;
  sessionId: string;
  projectId: string;
  agentId: string;
  skillId?: string;
  contractId?: string;
  status: RunStatus;
  prompt: string;
  result?: string;
  error?: string;
  openclawRunId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ChannelBinding {
  id: string;
  channel: ChannelName;
  channelId: string;
  displayName: string;
  room?: string;
  thread?: string;
  sessionId?: string;
  runId?: string;
  sender?: string;
  status: ConnectionState;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  workingDirectory?: string;
  defaultAgentId?: string;
  defaultMode?: AgentMode;
}

export interface CreateSessionInput {
  projectId: string;
  agentId?: string;
  title?: string;
  mode?: AgentMode;
}

export interface AgentMessage {
  sessionId: string;
  content: string;
  agentId?: string;
  skillId?: string;
  mode?: AgentMode;
  attachments?: Array<{ name: string; path: string }>;
}

export interface SearchResults {
  projects: Project[];
  sessions: Session[];
  runs: Run[];
  messages: Array<{
    id: string;
    sessionId: string;
    projectId: string;
    sessionTitle: string;
    role: ChatMessage["role"];
    excerpt: string;
  }>;
}

export interface DiagnosticsSnapshot {
  capsuleVersion: string;
  electronVersion?: string;
  macosVersion?: string;
  openclawVersion?: string;
  gatewayStatus: ConnectionState;
  databaseStatus: ConnectionState;
  pluginStatus?: string;
  connectionLogs: string[];
}

export type Unsubscribe = () => void;
