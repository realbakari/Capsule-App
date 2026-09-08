import type { AcpConfigOption } from "./harness.js";

/** Agent-reported facts. Reporting a feature never grants permission to use it. */
export interface AgentCapabilityReport {
  name?: string;
  version?: string;
  images?: boolean;
  embeddedContext?: boolean;
  httpMcp?: boolean;
  loadSession?: boolean;
  resumeSession?: boolean;
  closeSession?: boolean;
  configOptions: AcpConfigOption[];
}

export interface ReportedContextUsage {
  source: "agent";
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
}

export interface ReportedTurnUsage {
  source: "agent";
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  thoughtTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
}

export interface ApprovalToolDetails {
  toolCallId?: string;
  kind?: string;
  locations: string[];
  preview?: string;
  truncated: boolean;
  canApproveOnce: boolean;
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit = 128) => typeof value === "string"
  ? Array.from(value.slice(0, limit)).filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("").replace(/[\u202a-\u202e\u2066-\u2069]/g, "") : undefined;
const flag = (value: unknown) => typeof value === "boolean" ? value : undefined;
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
// IDs are sent back to the agent. Labels may be clipped; identities must not
// be rewritten into a different model or configuration value.
const identifier = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 128
  && text(value) === value ? value : undefined;

function readConfigChoices(value: unknown): AcpConfigOption["choices"] {
  const choices: AcpConfigOption["choices"] = [];
  for (const item of Array.isArray(value) ? value.slice(0, 32) : []) {
    const row = object(item);
    // ACP allows flat choices or one level of named groups. Flatten only that
    // level, with one shared output budget rather than 32 choices per group.
    const candidates = typeof row.group === "string" && Array.isArray(row.options)
      ? row.options.slice(0, 32) : [row];
    for (const candidate of candidates) {
      const choice = object(candidate);
      const value = identifier(choice.value);
      if (value) choices.push({ value, name: text(choice.name) ?? value, description: text(choice.description, 128) });
      if (choices.length === 32) return choices;
    }
  }
  return choices;
}

export function readAgentCapabilities(initialize: unknown, configuration?: unknown): AgentCapabilityReport {
  const response = object(initialize);
  const agent = object(response.agentInfo);
  const capabilities = object(response.agentCapabilities);
  const prompt = object(capabilities.promptCapabilities);
  const mcp = object(capabilities.mcpCapabilities);
  const sessions = object(capabilities.sessionCapabilities);
  const advertised = (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const configOptions: AcpConfigOption[] = [];
  for (const value of Array.isArray(configuration) ? configuration.slice(0, 16) : []) {
    const option = object(value);
    const id = identifier(option.id);
    if (!id || (option.type !== "select" && option.type !== "boolean")) continue;
    const choices = readConfigChoices(option.options);
    configOptions.push({ id, category: text(option.category), name: text(option.name) ?? id, description: text(option.description, 256),
      ...(option.type === "boolean" ? { type: "boolean" as const, booleanValue: flag(option.currentValue) } : { currentValue: identifier(option.currentValue) }), choices });
  }
  return {
    name: text(agent.name), version: text(agent.version), images: flag(prompt.image),
    embeddedContext: flag(prompt.embeddedContext), httpMcp: flag(mcp.http), loadSession: flag(capabilities.loadSession),
    resumeSession: advertised(sessions.resume), closeSession: advertised(sessions.close), configOptions,
  };
}

export function readReportedContextUsage(value: unknown): ReportedContextUsage | undefined {
  const row = object(value);
  const used = count(row.used);
  const size = count(row.size);
  if (used === undefined || !size) return;
  const cost = object(row.cost);
  const amount = typeof cost.amount === "number" && Number.isFinite(cost.amount) && cost.amount >= 0 ? cost.amount : undefined;
  const currency = typeof cost.currency === "string" && /^[A-Z]{3}$/.test(cost.currency) ? cost.currency : undefined;
  return { source: "agent", used, size, ...(amount !== undefined && currency ? { cost: { amount, currency } } : {}) };
}

export function readReportedTurnUsage(value: unknown): ReportedTurnUsage | undefined {
  const row = object(value);
  const result: ReportedTurnUsage = { source: "agent" };
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "thoughtTokens", "cachedReadTokens", "cachedWriteTokens"] as const) {
    const value = count(row[key]);
    if (value !== undefined) result[key] = value;
  }
  return Object.keys(result).length > 1 ? result : undefined;
}
