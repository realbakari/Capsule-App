import { describe, expect, it } from "vitest";
import { PRESET_HARNESSES, type HarnessStatus, type HarnessLiveStatus, type SessionRef } from "./harness.js";
import { harnessCapabilities } from "./harness-capabilities.js";

describe("capability-aware controls", () => {
  it("uses saved direct identity for the route and reported config options for live mutability", () => {
    const harness = { ...PRESET_HARNESSES.find((item) => item.id === "grok")!, runtimeRoute: "openclaw" } as HarnessStatus;
    const saved = { id: "s", harnessId: "grok", harnessState: "closed", directSession: { harnessId: "grok", sessionId: "native" } } as SessionRef;
    expect(harnessCapabilities({ harness, session: saved }).route).toBe("direct");
    const session = { ...saved, harnessState: "waiting" as const, openclawSessionKey: "direct:acp:grok:fixture" };
    const options = [{ id: "chosen-model", category: "model", name: "Model", currentValue: "one", choices: [{ value: "one", name: "One" }] }];
    const status: HarnessLiveStatus = { session, state: "waiting", parsed: { reported: { configOptions: options }, models: { availableModels: [{ modelId: "one", name: "One" }] } } };
    expect(harnessCapabilities({ harness, session, status }).model.state).toBe("available");
    expect(harnessCapabilities({ harness, session, status }).tuning.state).toBe("available");
    expect(harnessCapabilities({ harness, session: { ...session, openclawSessionKey: "replacement" }, status }).tuning.state).toBe("limited");
    status.parsed!.reported!.configOptions = [];
    expect(harnessCapabilities({ harness, session, status }).model.state).toBe("unavailable");
  });
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
    expect(harnessCapabilities({ harness, session: { ...session, openclawSessionKey: "agent:a:acp:replacement" }, status }).model.state).toBe("unavailable");
    expect(harnessCapabilities({ harness: { ...harness, id: "grok" }, session, status }).model.state).toBe("unavailable");
    expect(harnessCapabilities({ harness, session: { ...session, harnessState: "closed" }, status }).model.state).toBe("unavailable");
  });

  it.each([true, false, undefined])("uses this direct session's HTTP capability for browser availability (%s)", (httpMcp) => {
    const harness = { ...PRESET_HARNESSES[0], runtimeRoute: "direct" } as HarnessStatus;
    const session = { id: "s", harnessId: harness.id, openclawSessionKey: "direct:acp:fixture:1", harnessState: "waiting" } as SessionRef;
    const status: HarnessLiveStatus = { session, state: "waiting", parsed: { reported: { httpMcp, configOptions: [] } } };
    const feature = harnessCapabilities({ harness, session, status }).browser;
    expect(feature.state).toBe(httpMcp === true ? "limited" : "unavailable");
    if (httpMcp !== true) expect(feature.detail).toContain("manual browsing is still available");
    // A report from a previous process, another harness, or a closed session is not current evidence.
    expect(harnessCapabilities({ harness, session: { ...session, openclawSessionKey: "direct:acp:fixture:2" }, status }).browser.state).toBe("limited");
    expect(harnessCapabilities({ harness: { ...harness, id: "grok" }, session, status }).browser.state).toBe("limited");
    expect(harnessCapabilities({ harness, session: { ...session, harnessState: "closed" }, status }).browser.state).toBe("limited");
  });
});
