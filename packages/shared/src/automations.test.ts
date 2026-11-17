import { describe, expect, it } from "vitest";
import { automationFromDraft, scheduleRule } from "./automations.js";
import { describeRRule, parseRRule } from "./rrule.js";

const words = (rule: string) => {
  const parsed = parseRRule(rule);
  if (!parsed.ok) throw new Error(parsed.message);
  return describeRRule(parsed.rule);
};

describe("scheduleRule", () => {
  it("builds rules that read back as the choice made", () => {
    expect(words(scheduleRule({ kind: "weekdays", hour: 9, minute: 30 }))).toBe("Weekdays at 9:30");
    expect(words(scheduleRule({ kind: "weekly", day: "FR", hour: 17, minute: 0 }))).toBe("Every Friday at 17:00");
    expect(words(scheduleRule({ kind: "daily", hour: 2, minute: 0 }))).toBe("Every day at 2:00");
    expect(words(scheduleRule({ kind: "hourly" }))).toBe("Every hour at :00");
    expect(words(scheduleRule({ kind: "minutes", every: 15 }))).toBe("Every 15 minutes");
  });
});

describe("automationFromDraft", () => {
  const schedule = scheduleRule({ kind: "daily", hour: 9, minute: 0 });

  it("turns a draft into an entry that is on, with an id taken from its name", () => {
    expect(automationFromDraft({ name: " Triage new issues! ", schedule, prompt: " Triage them. ", workspace: "worktree" })).toEqual({
      ok: true,
      automation: { id: "triage-new-issues", name: "Triage new issues!", schedule, prompt: "Triage them.", workspace: "worktree", enabled: true },
    });
  });

  it("says what is missing or wrong before anything is written", () => {
    expect(automationFromDraft({ name: "", schedule, prompt: "x" })).toEqual({ ok: false, message: "Give it a name." });
    expect(automationFromDraft({ name: "A", schedule, prompt: "  " })).toEqual({ ok: false, message: "Write what it should send." });
    expect(automationFromDraft({ name: "A", schedule: scheduleRule({ kind: "minutes", every: 1 }), prompt: "x" }).ok).toBe(false);
  });
});
