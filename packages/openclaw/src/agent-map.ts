import { asRecord, asString } from "./events.js";

export interface GatewayAgentMap {
  defaultId: string;
  configuredIds: string[];
}

function agentEntries(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  for (const key of ["config", "parsed", "resolved", "runtimeConfig"]) {
    const agents = asRecord(asRecord(root[key]).agents);
    const entries = asRecord(agents.entries);
    if (Object.keys(entries).length > 0) return entries;
  }
  const agents = asRecord(root.agents);
  return asRecord(agents.entries);
}

export function agentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  if (!sessionKey) return undefined;
  if (sessionKey === "main") return "main";
  const match = /^agent:([^:]+):/.exec(sessionKey);
  return match?.[1];
}

export function looksLikeGatewaySessionKey(sessionKey: string | undefined): boolean {
  if (!sessionKey) return false;
  if (sessionKey === "main") return true;
  return sessionKey.startsWith("agent:") || sessionKey.includes(":acp:");
}

/** Agents the Gateway will actually accept on sessions.create / sessions.send. */
export function resolveGatewayAgentMap(input: {
  agentsList?: unknown;
  config?: unknown;
  status?: unknown;
}): GatewayAgentMap {
  const list = asRecord(input.agentsList);
  const heartbeat = asRecord(asRecord(input.status).heartbeat);
  const defaultId =
    asString(list.defaultId, asString(list.mainKey, asString(heartbeat.defaultAgentId, "main"))) ||
    "main";
  const configured = new Set<string>([defaultId, "main"]);

  for (const [id, value] of Object.entries(agentEntries(input.config))) {
    const record = asRecord(value);
    if (record.enabled === false) continue;
    configured.add(id);
  }

  for (const row of Array.isArray(heartbeat.agents) ? heartbeat.agents : []) {
    const record = asRecord(row);
    const id = asString(record.agentId, asString(record.id));
    if (!id) continue;
    if (record.enabled === false) {
      if (id !== defaultId && id !== "main") configured.delete(id);
      continue;
    }
    if (record.enabled === true) configured.add(id);
  }

  return { defaultId, configuredIds: [...configured] };
}

export function pickGatewayAgentId(
  requested: string | undefined,
  map: GatewayAgentMap,
): string {
  if (requested && map.configuredIds.includes(requested)) return requested;
  return map.defaultId;
}

export function sessionKeyIsConfigured(
  sessionKey: string | undefined,
  map: GatewayAgentMap,
): boolean {
  if (!looksLikeGatewaySessionKey(sessionKey)) return false;
  const agentId = agentIdFromSessionKey(sessionKey);
  if (!agentId) return true;
  return map.configuredIds.includes(agentId);
}
