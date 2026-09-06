import { describe, expect, it } from "vitest";
import { PRESET_HARNESSES, type HarnessStatus, type HarnessLiveStatus, type SessionRef } from "./harness.js";
import { harnessCapabilities } from "./harness-capabilities.js";

describe("capability-aware controls", () => {
  for (const preset of PRESET_HARNESSES) it(`${preset.id}: derives live controls from the thread route, not the new-thread default`, () => {
    const harness = { ...preset, runtimeRoute: "openclaw" } as HarnessStatus;
    const session = { id: "s", harnessId: preset.id, openclawSessionKey: "direct:acp:test:1", harnessState: "waiting" } as SessionRef;
    const direct = harnessCapabilities({ harness, session });
    expect(direct.model.state).toBe("unavailable");
    expect(direct.tuning.state).toBe("unavailable");
    expect(direct.steer.detail).toContain("follow-up");
    expect(direct.browser.state).toBe("limited");
    const gateway = harnessCapabilities({ harness: { ...harness, runtimeRoute: "direct" }, session: { ...session, openclawSessionKey: "agent:test:acp:1" } });
    expect(gateway.route).toBe("openclaw");
    expect(gateway.browser.state).toBe("unavailable");
    expect(gateway.model.state).toBe("unavailable");
  });
  it("only offers model choices for the selected, live session", () => {
    const harness = { ...PRESET_HARNESSES[0], runtimeRoute: "openclaw" } as HarnessStatus;
    const session = { id: "s", harnessId: harness.id, openclawSessionKey: "agent:a:acp:1", harnessState: "waiting" } as SessionRef;
    const status = { session, parsed: { models: { availableModels: [{ modelId: "example", name: "Example" }] } } } as HarnessLiveStatus;
    expect(harnessCapabilities({ harness, session, status }).model.state).toBe("available");
    expect(harnessCapabilities({ harness, session: { ...session, id: "other" }, status }).model.state).toBe("unavailable");
    expect(harnessCapabilities({ harness: { ...harness, id: "grok" }, session, status }).model.state).toBe("unavailable");
    expect(harnessCapabilities({ harness, session: { ...session, harnessState: "closed" }, status }).model.state).toBe("unavailable");
  });
});
