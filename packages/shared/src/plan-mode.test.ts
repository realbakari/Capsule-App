import { describe, expect, it } from "vitest";
import type { AcpConfigOption } from "./harness.js";
import {
  actModeValue,
  findPlanOption,
  modelFavoriteKey,
  modeModelFor,
  nextFavoriteModel,
  normalizeFavoriteModels,
  normalizeModeModels,
  planModeSupport,
  withoutPlanChoice,
} from "./plan-mode.js";
import { normalizeCapsuleSettings } from "./runtime.js";

const mode = (choices: string[], currentValue?: string): AcpConfigOption => ({ id: "mode", category: "mode", name: "Mode", currentValue,
  choices: choices.map((value) => ({ value, name: value[0]!.toUpperCase() + value.slice(1) })) });

describe("planModeSupport", () => {
  it.each([
    ["claude", "direct", undefined, "Enforced by Claude Code", true],
    ["claude", "direct", [mode(["default", "plan"], "default")], "Enforced by Claude Code", true],
    ["codex", "direct", undefined, "Read-only, enforced by Codex", true],
    ["codex", "direct", [mode(["default", "plan"], "default")], "Read-only, enforced by Codex", true],
    ["gemini", "direct", [mode(["default", "plan"])], "Enforced by Gemini CLI", true],
    ["gemini", "direct", [], "Asked, not enforced", false],
    ["claude", "gateway", [mode(["default", "plan"])], "Enforced by Claude Code", true],
    ["claude", "gateway", [], "Asked, not enforced", false],
    ["muse", "direct", [], "Asked, not enforced", false],
  ] as const)("%s on %s with %j options says %s", (harnessId, route, options, label, enforced) => {
    const names: Record<string, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI", muse: "Muse" };
    const support = planModeSupport({ harnessId, harnessName: names[harnessId], route, options, reported: Boolean(options) });
    expect(support.label).toBe(label);
    expect(support.enforced).toBe(enforced);
  });

  it("tells a pending report from a known absence", () => {
    expect(planModeSupport({ harnessId: "gemini", harnessName: "Gemini CLI", route: "direct", reported: false }).detail).toMatch(/has not reported a plan mode yet/);
    expect(planModeSupport({ harnessId: "gemini", harnessName: "Gemini CLI", route: "gateway", reported: true, options: [] }).detail).toMatch(/does not report a plan mode through the Gateway/);
  });

  it("labels the demo runtime, and treats a Gateway agent without a harness as asked only", () => {
    expect(planModeSupport({ route: "mock", reported: false }).carrier.kind).toBe("mock");
    expect(planModeSupport({ route: "gateway", reported: false }).label).toBe("Asked, not enforced");
  });
});

describe("reported mode options", () => {
  it("finds a plan choice by value or name and returns to the saved, current, or likeliest act choice", () => {
    expect(findPlanOption([mode(["code", "plan"])])?.planValue).toBe("plan");
    expect(findPlanOption([{ ...mode([]), choices: [{ value: "architect", name: "Plan first" }, { value: "code", name: "Code" }] }])?.planValue).toBe("architect");
    expect(findPlanOption([mode(["code", "ask"])])).toBeUndefined();
    expect(findPlanOption([mode(["code", "planner"])])).toBeUndefined();
    const option = mode(["ask", "code", "plan"], "plan");
    expect(actModeValue(option, "plan", "ask")).toBe("ask");
    expect(actModeValue(option, "plan", "plan")).toBe("code");
    expect(actModeValue(mode(["ask", "code", "plan"], "ask"), "plan")).toBe("ask");
  });

  it("drops the plan choice from the composer picker, and the picker when nothing is left to pick", () => {
    expect(withoutPlanChoice(mode(["default", "plan"]))).toBeUndefined();
    expect(withoutPlanChoice(mode(["ask", "code", "plan"]))?.choices.map((choice) => choice.value)).toEqual(["ask", "code"]);
    expect(withoutPlanChoice(mode(["ask", "code"]))?.choices).toHaveLength(2);
  });
});

describe("mode models and favorites", () => {
  it("normalizes per-mode models and favorites in settings", () => {
    const settings = normalizeCapsuleSettings({
      modeModels: { claude: { plan: " deep ", act: "" }, "bad id!": { plan: "x" }, codex: "nope" } as never,
      favoriteModels: [modelFavoriteKey("claude", "a"), "not json", modelFavoriteKey("claude", "a"), JSON.stringify(["only-one"])],
    });
    expect(settings.modeModels).toEqual({ claude: { plan: "deep" } });
    expect(settings.favoriteModels).toEqual([modelFavoriteKey("claude", "a")]);
    expect(settings.startInPlanMode).toBe(false);
    expect(modeModelFor(settings.modeModels, "claude", "plan")).toBe("deep");
    expect(modeModelFor(settings.modeModels, "claude", "act")).toBeUndefined();
    expect(normalizeModeModels(null)).toEqual({});
    expect(normalizeFavoriteModels("x")).toEqual([]);
  });

  it("cycles this agent's favorites in starred order, wraps, and skips models the agent no longer reports", () => {
    const favorites = ["b", "gone", "a"].map((id) => modelFavoriteKey("claude", id)).concat(modelFavoriteKey("codex", "c"));
    const available = ["a", "b", "c"];
    expect(nextFavoriteModel(favorites, "claude", available, undefined)).toBe("b");
    expect(nextFavoriteModel(favorites, "claude", available, "b")).toBe("a");
    expect(nextFavoriteModel(favorites, "claude", available, "a")).toBe("b");
    expect(nextFavoriteModel(favorites, "claude", available, "c")).toBe("b");
    expect(nextFavoriteModel(favorites, "codex", ["a"], undefined)).toBeUndefined();
  });
});
