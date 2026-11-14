import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { describeRRule, nextOccurrence, occurrencesBetween, parseRRule, type RRule } from "./rrule.js";

function rule(text: string): RRule {
  const parsed = parseRRule(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.rule;
}

function failure(text: string): string {
  const parsed = parseRRule(text);
  if (parsed.ok) throw new Error(`expected ${text} to be rejected`);
  return parsed.message;
}

/** Local wall-clock time; 5 January 2026 is a Monday. */
const at = (month: number, day: number, hour = 0, minute = 0, year = 2026) => new Date(year, month - 1, day, hour, minute);

const WEEKDAYS_AT_9 = "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0";

describe("parseRRule", () => {
  it("accepts a rule with or without the RRULE prefix, in any case", () => {
    expect(rule(WEEKDAYS_AT_9)).toEqual(rule("freq=weekly;byday=mo,tu,we,th,fr;byhour=9;byminute=0"));
    expect(rule("FREQ=DAILY")).toMatchObject({ freq: "DAILY", interval: 1, byDay: [], byHour: [] });
  });

  it("rejects a minutely rule that would run more often than every 5 minutes", () => {
    expect(failure("FREQ=MINUTELY")).toMatch(/at most every 5 minutes/);
    expect(failure("FREQ=MINUTELY;INTERVAL=4")).toMatch(/at most every 5 minutes/);
    expect(rule("FREQ=MINUTELY;INTERVAL=5").interval).toBe(5);
  });

  it("rejects COUNT and points at UNTIL instead", () => {
    expect(failure("FREQ=DAILY;COUNT=3")).toMatch(/UNTIL/);
  });

  it("rejects what it cannot honour instead of ignoring it", () => {
    expect(failure("FREQ=YEARLY")).toMatch(/not supported/);
    expect(failure("FREQ=DAILY;BYSETPOS=1")).toMatch(/BYSETPOS/);
    expect(failure("FREQ=MONTHLY;BYDAY=1MO")).toMatch(/numbered weekdays/);
    expect(failure("FREQ=WEEKLY;BYMONTHDAY=1")).toMatch(/WEEKLY/);
    expect(failure("FREQ=DAILY;BYHOUR=24")).toMatch(/BYHOUR/);
    expect(failure("FREQ=MONTHLY;BYMONTHDAY=0")).toMatch(/BYMONTHDAY/);
    expect(failure("FREQ=DAILY;INTERVAL=0")).toMatch(/INTERVAL/);
    expect(failure("FREQ=DAILY;FREQ=WEEKLY")).toMatch(/twice/);
    expect(failure("BYHOUR=9")).toMatch(/FREQ/);
    expect(failure("FREQ=DAILY;UNTIL=20260231")).toMatch(/UNTIL/);
  });
});

describe("nextOccurrence", () => {
  it("skips the weekend for a weekday rule", () => {
    expect(nextOccurrence(rule(WEEKDAYS_AT_9), at(1, 9, 10))).toEqual(at(1, 12, 9));
  });

  it("is strictly after the given time", () => {
    expect(nextOccurrence(rule(WEEKDAYS_AT_9), at(1, 12, 9))).toEqual(at(1, 13, 9));
    expect(nextOccurrence(rule(WEEKDAYS_AT_9), at(1, 12, 8, 59))).toEqual(at(1, 12, 9));
  });

  it("runs every day at a set time", () => {
    expect(nextOccurrence(rule("FREQ=DAILY;BYHOUR=18;BYMINUTE=30"), at(1, 5, 18, 31))).toEqual(at(1, 6, 18, 30));
  });

  it("counts hourly intervals from the anchor", () => {
    const everyTwoHours = rule("FREQ=HOURLY;INTERVAL=2");
    expect(nextOccurrence(everyTwoHours, at(1, 5, 3, 10))).toEqual(at(1, 5, 4));
    expect(nextOccurrence(everyTwoHours, at(1, 5, 3, 10), at(1, 5, 1, 15))).toEqual(at(1, 5, 3, 15));
    expect(nextOccurrence(everyTwoHours, at(1, 5, 3, 15), at(1, 5, 1, 15))).toEqual(at(1, 5, 5, 15));
  });

  it("applies day and hour limits to a minutely rule", () => {
    const workHours = rule("FREQ=MINUTELY;INTERVAL=15;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9,10");
    expect(nextOccurrence(workHours, at(1, 9, 10, 50))).toEqual(at(1, 12, 9));
    expect(nextOccurrence(workHours, at(1, 12, 9, 1))).toEqual(at(1, 12, 9, 15));
  });

  it("counts week intervals from the anchor's week", () => {
    const fortnightly = rule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9");
    const created = at(1, 5, 8);
    expect(nextOccurrence(fortnightly, created, created)).toEqual(at(1, 5, 9));
    expect(nextOccurrence(fortnightly, at(1, 5, 9), created)).toEqual(at(1, 19, 9));
  });

  it("takes the time and weekday a rule leaves out from the anchor, and never fires before it", () => {
    const created = at(1, 7, 14, 20);
    expect(nextOccurrence(rule("FREQ=DAILY"), at(1, 1, 0, 0, 2025), created)).toEqual(created);
    expect(nextOccurrence(rule("FREQ=DAILY"), created, created)).toEqual(at(1, 8, 14, 20));
    expect(nextOccurrence(rule("FREQ=WEEKLY"), created, created)).toEqual(at(1, 14, 14, 20));
  });

  it("skips months without the day and counts back from the end", () => {
    expect(nextOccurrence(rule("FREQ=MONTHLY;BYMONTHDAY=31;BYHOUR=9"), at(1, 31, 10))).toEqual(at(3, 31, 9));
    expect(nextOccurrence(rule("FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=9"), at(1, 31, 10))).toEqual(at(2, 28, 9));
  });

  it("expands plain weekdays across a month", () => {
    const mondays = rule("FREQ=MONTHLY;BYDAY=MO;BYHOUR=9");
    expect(nextOccurrence(mondays, at(1, 26, 10))).toEqual(at(2, 2, 9));
  });

  it("finds a leap day years away and gives up on a day that never comes", () => {
    const anchor = at(2, 1, 0, 0, 2024);
    expect(nextOccurrence(rule("FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=29"), at(2, 29, 1, 0, 2024), anchor)).toEqual(at(2, 29, 0, 0, 2028));
    expect(nextOccurrence(rule("FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=30"), anchor, anchor)).toBeUndefined();
  });

  it("stops after UNTIL, which is inclusive", () => {
    const ending = rule("FREQ=DAILY;BYHOUR=9;UNTIL=20260107");
    expect(nextOccurrence(ending, at(1, 6, 10))).toEqual(at(1, 7, 9));
    expect(nextOccurrence(ending, at(1, 7, 9))).toBeUndefined();
  });
});

describe("occurrencesBetween", () => {
  const closedFrom = at(1, 9, 18);
  const closedTo = at(1, 12, 10);

  it("counts what a closed app missed", () => {
    expect(occurrencesBetween(rule("FREQ=DAILY;BYHOUR=9"), closedFrom, closedTo)).toEqual([at(1, 10, 9), at(1, 11, 9), at(1, 12, 9)]);
    expect(occurrencesBetween(rule(WEEKDAYS_AT_9), closedFrom, closedTo)).toEqual([at(1, 12, 9)]);
  });

  it("stops at the limit", () => {
    expect(occurrencesBetween(rule("FREQ=MINUTELY;INTERVAL=5"), closedFrom, closedTo, 10)).toHaveLength(10);
  });
});

describe("daylight saving", () => {
  const previous = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    process.env.TZ = previous;
  });

  it("skips a wall-clock time the clocks jump over", () => {
    const nightly = rule("FREQ=DAILY;BYHOUR=2;BYMINUTE=30");
    expect(nextOccurrence(nightly, at(3, 7, 3))).toEqual(at(3, 9, 2, 30));
  });

  it("keeps a daily time on the wall clock across the change", () => {
    expect(nextOccurrence(rule("FREQ=DAILY;BYHOUR=9"), at(3, 7, 10))).toEqual(at(3, 8, 9));
  });
});

describe("describeRRule", () => {
  it.each([
    [WEEKDAYS_AT_9, "Weekdays at 9:00"],
    ["FREQ=DAILY;BYHOUR=18;BYMINUTE=30", "Every day at 18:30"],
    ["FREQ=HOURLY;INTERVAL=2", "Every 2 hours"],
    ["FREQ=HOURLY;BYMINUTE=15", "Every hour at :15"],
    ["FREQ=MINUTELY;INTERVAL=15;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9,10,11", "Every 15 minutes on weekdays from 9:00 to 11:59"],
    ["FREQ=WEEKLY;BYDAY=SA,SU;BYHOUR=10", "Weekends at 10:00"],
    ["FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=9;BYMINUTE=5", "Every Monday and Wednesday at 9:05"],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;BYHOUR=16", "Every 2 weeks on Friday at 16:00"],
    ["FREQ=DAILY;BYHOUR=9,17", "Every day at 9:00 and 17:00"],
    ["FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=8", "Every month on the 1st at 8:00"],
    ["FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=17", "Every month on the last day at 17:00"],
    ["FREQ=DAILY;BYHOUR=9;UNTIL=20261231", "Every day at 9:00 until 2026-12-31"],
  ])("%s reads as %s", (text, words) => {
    expect(describeRRule(rule(text))).toBe(words);
  });

  it("uses the anchor for the parts a rule leaves out", () => {
    expect(describeRRule(rule("FREQ=WEEKLY"), at(1, 7, 14, 20))).toBe("Every Wednesday at 14:20");
  });
});
