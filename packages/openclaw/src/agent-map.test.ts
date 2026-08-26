import { describe, expect, it } from "vitest";
import {
  agentIdFromSessionKey,
  pickGatewayAgentId,
  resolveGatewayAgentMap,
  sessionKeyIsConfigured,
} from "./agent-map.js";

describe("gateway agent map", () => {
  it("ignores leftover workspace agents that are not in config", () => {
    const map = resolveGatewayAgentMap({
      agentsList: {
        defaultId: "main",
        mainKey: "main",
        agents: [{ id: "main" }, { id: "general" }, { id: "coding" }, { id: "claude" }],
      },
      config: { parsed: { agents: { defaults: { maxConcurrent: 4 } } } },
      status: {
        heartbeat: {
          defaultAgentId: "main",
          agents: [
            { agentId: "main", enabled: true },
            { agentId: "general", enabled: false },
            { agentId: "coding", enabled: false },
            { agentId: "claude", enabled: false },
          ],
        },
      },
    });
    expect(map.defaultId).toBe("main");
    expect(map.configuredIds).toEqual(["main"]);
    expect(pickGatewayAgentId("general", map)).toBe("main");
    expect(pickGatewayAgentId("coding", map)).toBe("main");
    expect(sessionKeyIsConfigured("agent:general:dashboard:1", map)).toBe(false);
    expect(sessionKeyIsConfigured("agent:main:dashboard:1", map)).toBe(true);
  });

  it("uses a configured OpenClaw agent when one exists", () => {
    const map = resolveGatewayAgentMap({
      agentsList: { defaultId: "main" },
      config: {
        parsed: { agents: { entries: { research: { enabled: true } } } },
      },
      status: {
        heartbeat: {
          defaultAgentId: "main",
          agents: [
            { agentId: "main", enabled: true },
            { agentId: "research", enabled: true },
          ],
        },
      },
    });
    expect(pickGatewayAgentId("research", map)).toBe("research");
    expect(pickGatewayAgentId("general", map)).toBe("main");
    expect(agentIdFromSessionKey("agent:research:acp:9")).toBe("research");
  });
});
