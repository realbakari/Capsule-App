import { describe, expect, it } from "vitest";
import { REASONING_EFFORTS, readReasoningEffort, reasoningFromPage, reasoningOption } from "./configuration.js";

describe("native reasoning configuration", () => {
  const event = (reasoningEffort: unknown, sessionId = "session") => ({
    method: "session/reasoningEffortChanged", params: { sessionId, reasoningEffort },
  });
  it("preserves the exact eight tiers, including none and max", () => {
    for (const tier of REASONING_EFFORTS) expect(readReasoningEffort(tier)).toBe(tier);
    for (const invalid of [true, null, "auto", "unset", "HIGH", {}, 0]) expect(readReasoningEffort(invalid)).toBeUndefined();
    expect(reasoningOption().currentValue).toBeUndefined();
    expect(reasoningOption("none").choices.map((choice) => choice.value)).toEqual(REASONING_EFFORTS);
  });
  it("extracts only the latest valid session setting from a bounded ascending page", () => {
    expect(reasoningFromPage({ events: [event("low"), event("high"), event("ultra", "other"), event(false)] }, "session")).toBe("high");
    for (const page of [null, {}, { events: "wrong" }, { events: Array(101).fill(event("high")) }]) expect(reasoningFromPage(page, "session")).toBeUndefined();
  });
});
