import type { HarnessPermissionProfile } from "./harness.js";

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

export type WorkspaceMode = "local" | "worktree";

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
  /** Absent when the source does not declare one — do not synthesise "1.0.0". */
  version?: string;
  description: string;
  source: string;
  status: "installed" | "disabled" | "invalid" | "available";
  requirements: string[];
  permissions: Record<string, PolicyDecisionKind>;
  validation?: "passed" | "failed" | "unvalidated";
  packId?: string;
  packName?: string;
  content?: string;
  installs?: number;
  tags?: string[];
  author?: string;
  url?: string;
  files?: Array<{ path: string; contents: string }>;
  /** Local SKILL.md path when this entry was discovered from an agent CLI. */
  location?: string;
  /** True when another CLI owns the files and Capsule must not remove them. */
  managedExternally?: boolean;
}

export interface SkillPack {
  id: string;
  name: string;
  description: string;
  author?: string;
  url?: string;
  installCommand?: string;
  tags?: string[];
  skillCount: number;
  skills?: Skill[];
  createdAt?: string;
}

/** One skill in the live catalog, as read from its source repository. */
export interface SkillCatalogEntry {
  id: string;
  name: string;
  /** "owner/repo" the skill lives in. */
  source: string;
  url: string;
  description?: string;
  /** Stars on the source repository. Absent when the fetch did not return it. */
  stars?: number;
  /** Install count, when the source reports one (skills.sh does; GitHub does not). */
  installs?: number;
  /** Where this entry came from, so the card can say. */
  origin?: "github" | "skills.sh";
  /** Path to SKILL.md inside the repo. */
  docPath?: string;
  /** Branch the paths above resolve against. */
  ref?: string;
}

export interface SkillCatalogPage {
  entries: SkillCatalogEntry[];
  /** Per-source failures, so a partial catalog can say what is missing. */
  errors: string[];
  fetchedAt: number;
  /** Whether a skills.sh token was configured for this fetch. */
  skillsShConnected?: boolean;
}

export interface SkillsShSearchResult {
  id: string;
  slug: string;
  name: string;
  source: string;
  /** Absent when the source does not report one. Never substitute a guess. */
  installs?: number;
  sourceType: string;
  installUrl?: string | null;
  url: string;
  description?: string;
}

export interface SkillsShSkillDetail {
  id: string;
  source: string;
  slug: string;
  installs?: number;
  hash?: string | null;
  files?: Array<{ path: string; contents: string }> | null;
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
  /** Primary folder: cwd, git, AGENTS.md, and new chats. */
  workingDirectory?: string;
  /** Extra folders the agent and Files panel can read; git stays on the primary. */
  extraFolders?: string[];
  /** Saved, project-scoped commands exposed in the titlebar. */
  actions?: ProjectAction[];
  /** Saved image path. When absent, Capsule probes common project icon paths. */
  iconPath?: string;
  /** Resolved image payload returned to the renderer; never stored in SQLite. */
  iconDataUrl?: string;
  defaultAgentId?: string;
  defaultSkillIds: string[];
  defaultMode: AgentMode;
  /**
   * Where new conversations in this project run. Unset means the app-wide
   * default: a repo you always want isolated and one you never do cannot be
   * expressed by one global switch.
   */
  defaultWorkspaceMode?: WorkspaceMode;
  /**
   * What capsule.json in this project's folder says, if anything. Read on
   * every list rather than stored: it is a file someone edits with the app
   * open, and a stale copy would be worse than none.
   */
  projectFile?: import("./project-file.js").ProjectFileState;
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
  /** Stable ordering among pinned conversations; lower values appear first. */
  pinOrder?: number;
  /** Per-thread cwd for Inbox / projectless tasks. Project repos leave this unset. */
  workingDirectory?: string;
  /** Whether the conversation shares the project checkout or owns a Git worktree. */
  workspaceMode?: WorkspaceMode;
  /** Branch created for a worktree conversation. */
  worktreeBranch?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  workingDirectory?: string | null;
  extraFolders?: string[];
  actions?: ProjectAction[];
  iconPath?: string | null;
  defaultAgentId?: string | null;
  defaultMode?: AgentMode;
  /** null clears the override and returns the project to the app-wide default. */
  defaultWorkspaceMode?: WorkspaceMode | null;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface ProjectAction {
  id: string;
  name: string;
  command: string;
  /** Optional local URL selected in the Browser panel after the action starts. */
  previewUrl?: string;
  /**
   * Run this automatically when a conversation gets its own worktree. A fresh
   * checkout usually needs an install before anything else works.
   */
  runOnWorktreeCreate?: boolean;
  /**
   * Open the preview URL when the action runs. Defaults to true for an action
   * that has one — that was the only behaviour before this was a choice.
   */
  openPreview?: boolean;
}

export interface ProjectActionRun {
  projectId: string;
  actionId: string;
  sessionId?: string;
  status: "running" | "completed" | "failed" | "stopped";
  pid?: number;
  output: string;
  startedAt: string;
  completedAt?: string;
}

export interface LocalServer {
  port: number;
  command: string;
  pid: number;
  url: string;
  title?: string;
  protocol: "http" | "https";
}

export interface GitChange {
  path: string;
  code: string;
  /** Lines added, from `git diff --numstat`. Absent for binary or untracked files. */
  added?: number;
  /** Lines removed. Absent for binary or untracked files. */
  removed?: number;
}

export interface ContentHit {
  path: string;
  line: number;
  text: string;
}

export interface GitPullRequest {
  number: number;
  url: string;
  title: string;
  isDraft: boolean;
  state: string;
  mergeState?: string;
  reviewDecision?: string;
  checks?: "pending" | "success" | "failure" | "none";
  checksSummary?: string;
  author?: string;
  headRefName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GitPullRequestActivity {
  id: string;
  kind: "comment" | "review";
  author?: string;
  body: string;
  createdAt?: string;
  state?: string;
}

export interface GitPullRequestCommit {
  oid: string;
  title: string;
  body?: string;
  authoredAt?: string;
  authors: string[];
}

/**
 * A label, with the colour the repository gave it.
 *
 * This used to be reduced to a name. GitHub picks these colours deliberately —
 * green for a vouched author, orange for a large change — and a wall of
 * identical grey pills throws away the one thing that makes a label scannable.
 */
export interface GitPullRequestLabel {
  name: string;
  /** Six hex digits, no leading `#`, exactly as GitHub stores it. */
  color?: string;
  description?: string;
}

/** One check run or status context reported against a pull request's head. */
export interface GitPullRequestCheck {
  name: string;
  /** The workflow it belongs to, when GitHub names one. */
  workflow?: string;
  state: "success" | "failure" | "pending" | "skipped" | "neutral" | "cancelled";
  url?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface GitPullRequestFile {
  path: string;
  additions: number;
  deletions: number;
}

/** Host-backed detail for Capsule's in-app pull-request reader. */
export interface GitPullRequestDetail extends GitPullRequest {
  body: string;
  baseRefName?: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: GitPullRequestLabel[];
  reviewers: string[];
  /*
   * Avatars by GitHub login, as data URIs.
   *
   * Fetched in the main process and inlined, because the renderer's CSP
   * allows images only from itself and `data:` — and widening it to reach
   * github.com would put every pull request view on the network from inside
   * the renderer. Absent for anyone whose avatar could not be fetched, which
   * is what the initials fallback is for.
   */
  avatars?: Record<string, string>;
  activity: GitPullRequestActivity[];
  commits: GitPullRequestCommit[];
  files: GitPullRequestFile[];
  /*
   * Every check by name, not just the one word `checks` reduces them to. The
   * rollup answers "is anything failing"; this answers "what is failing", and
   * GitHub already sends it in the same response.
   */
  checkRuns: GitPullRequestCheck[];
  diff: string;
  /*
   * Why there is no patch, when there is none. GitHub refuses a diff of more
   * than 300 files outright, and without this the Code tab said only "No patch
   * was returned" — which reads as a bug in Capsule rather than a limit at the
   * other end that no amount of retrying will move.
   */
  diffUnavailable?: string;
}

export interface GitStatus {
  available: boolean;
  isRepo: boolean;
  branch?: string;
  dirty: boolean;
  changed: number;
  summary: string;
  files: GitChange[];
  branches: string[];
  ghAvailable?: boolean;
  ahead?: number;
  behind?: number;
  /** Totals across `files`, for a one-line "+12 −3" summary. */
  added?: number;
  removed?: number;
  pullRequest?: GitPullRequest;
}

export interface MessageAttachment {
  name: string;
  path: string;
  size: number;
  mimeType?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: MessageAttachment[];
  /** Set when the turn is something other than a plain message, e.g. a steer
   *  sent into an in-flight run. Carries intent the content should not. */
  kind?: "steer";
  runId?: string;
  createdAt: string;
}

/** One page of a conversation, oldest-first, with a cursor for the page before it. */
export interface MessagePage {
  messages: ChatMessage[];
  /** True when older messages exist before `messages[0]`. */
  hasMore: boolean;
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
    /**
     * Advisory checks are guidance to the agent, not testable postconditions —
     * a prose keyword match cannot decide whether a turn succeeded. They are
     * reported but never fail the run.
     */
    advisory?: boolean;
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
  /** Hidden Git ref capturing the worktree when this turn finished. */
  checkpointRef?: string;
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

export interface CloneRepositoryInput {
  url: string;
  parentDirectory: string;
  name?: string;
}

export interface CreateSessionInput {
  projectId: string;
  agentId?: string;
  title?: string;
  mode?: AgentMode;
  permissionProfile?: import("./harness.js").HarnessPermissionProfile;
  workingDirectory?: string;
  workspaceMode?: WorkspaceMode;
}

export interface AgentMessage {
  sessionId: string;
  content: string;
  agentId?: string;
  skillId?: string;
  mode?: AgentMode;
  attachments?: MessageAttachment[];
  /**
   * The conversation's permission profile, carried per turn so the runtime can
   * (re)apply it to a session that was created before the profile changed.
   */
  permissionProfile?: HarnessPermissionProfile;
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

/** One shell running in Capsule's terminal panel. */
export interface TerminalHandle {
  id: string;
  pid: number;
  cwd: string;
}

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  code: number;
}

/** One process in the resource monitor. */
export interface MonitoredProcess {
  pid: number;
  name: string;
  /** Percent of one core. Summing these across processes can exceed 100. */
  cpuPercent: number;
  memoryBytes: number;
  uptimeMs?: number;
  /** Electron's own process type, for the app's own processes. */
  type?: string;
  /** Set for agent processes: a pid alone is not an identity. */
  startTimeMs?: number;
}

export interface ResourceSample {
  sampledAt: number;
  /** Capsule's own processes, from Electron. */
  app: MonitoredProcess[];
  /** The agent CLIs and whatever they spawned, read from the OS. */
  agents: MonitoredProcess[];
  /** How many processes the OS reported but Capsule could not read. */
  inaccessibleCount: number;
}

/** Totals kept per sample so a long window stays small. */
export interface ResourceHistoryPoint {
  sampledAt: number;
  appCpuPercent: number;
  appMemoryBytes: number;
  agentCpuPercent: number;
  agentMemoryBytes: number;
  agentCount: number;
}

/** What the Settings screen shows about devices reading this Capsule. */
export interface RemoteAccessStatus {
  reach: "off" | "loopback" | "network";
  url?: string;
  /** Undefined until someone asks for a link; it is only shown once. */
  pairingUrl?: string;
  devices: Array<{
    id: string;
    label: string;
    scopes: string[];
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
  }>;
  error?: string;
}
