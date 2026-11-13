export type RRuleFrequency = "MINUTELY" | "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY";

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

/** Monday first, the RFC 5545 default week start. */
export const WEEKDAYS: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** The subset of an RFC 5545 recurrence rule automations use. Times are local. */
export interface RRule {
  freq: RRuleFrequency;
  interval: number;
  byDay: Weekday[];
  byHour: number[];
  byMinute: number[];
  /** 1 to 31, or -1 to -31 counting back from the month's last day. */
  byMonthDay: number[];
  /** Inclusive end. */
  until?: Date;
}

export type ParsedRRule = { ok: true; rule: RRule } | { ok: false; message: string };

/** Automations must not spin, so a minutely rule runs at most every 5 minutes. */
export const MIN_MINUTELY_INTERVAL = 5;

const FREQUENCIES: readonly RRuleFrequency[] = ["MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY"];
const PARTS = new Set(["FREQ", "INTERVAL", "BYDAY", "BYHOUR", "BYMINUTE", "BYMONTHDAY", "UNTIL"]);

export function parseRRule(text: string): ParsedRRule {
  const body = text.trim().replace(/^RRULE:/i, "");
  if (!body) return { ok: false, message: "The schedule is empty." };
  const parts = new Map<string, string>();
  for (const piece of body.split(";")) {
    if (!piece) continue;
    const eq = piece.indexOf("=");
    const name = (eq === -1 ? piece : piece.slice(0, eq)).trim().toUpperCase();
    const value = eq === -1 ? "" : piece.slice(eq + 1).trim().toUpperCase();
    if (name === "COUNT") return { ok: false, message: "COUNT is not supported. Use UNTIL to end a schedule." };
    if (!PARTS.has(name)) return { ok: false, message: `${name} is not supported in a schedule.` };
    if (parts.has(name)) return { ok: false, message: `${name} appears twice.` };
    if (!value) return { ok: false, message: `${name} has no value.` };
    parts.set(name, value);
  }

  const freq = parts.get("FREQ");
  if (!freq) return { ok: false, message: "A schedule needs FREQ, such as FREQ=DAILY." };
  if (!(FREQUENCIES as readonly string[]).includes(freq)) {
    return { ok: false, message: `FREQ=${freq} is not supported. Use ${FREQUENCIES.join(", ")}.` };
  }

  const interval = parts.has("INTERVAL") ? parseInteger(parts.get("INTERVAL")!) : 1;
  if (interval === undefined || interval < 1 || interval > 1000) {
    return { ok: false, message: "INTERVAL must be a whole number from 1 to 1000." };
  }
  if (freq === "MINUTELY" && interval < MIN_MINUTELY_INTERVAL) {
    return {
      ok: false,
      message: `An automation can run at most every ${MIN_MINUTELY_INTERVAL} minutes. Use FREQ=MINUTELY;INTERVAL=${MIN_MINUTELY_INTERVAL} or more.`,
    };
  }

  const byDay: Weekday[] = [];
  for (const day of list(parts.get("BYDAY"))) {
    if (/^[+-]?\d/.test(day)) return { ok: false, message: `BYDAY=${day}: numbered weekdays are not supported. Use plain days such as MO,FR.` };
    if (!(WEEKDAYS as readonly string[]).includes(day)) return { ok: false, message: `BYDAY=${day} is not a weekday. Use MO, TU, WE, TH, FR, SA or SU.` };
    if (!byDay.includes(day as Weekday)) byDay.push(day as Weekday);
  }

  const byHour = numbers(parts.get("BYHOUR"), 0, 23);
  if (typeof byHour === "string") return { ok: false, message: `BYHOUR ${byHour}` };
  const byMinute = numbers(parts.get("BYMINUTE"), 0, 59);
  if (typeof byMinute === "string") return { ok: false, message: `BYMINUTE ${byMinute}` };
  const byMonthDay = numbers(parts.get("BYMONTHDAY"), -31, 31);
  if (typeof byMonthDay === "string" || byMonthDay.includes(0)) {
    return { ok: false, message: "BYMONTHDAY values must be 1 to 31, or -1 to -31 counting from the month's end." };
  }
  if (freq === "WEEKLY" && byMonthDay.length > 0) return { ok: false, message: "BYMONTHDAY cannot be used with FREQ=WEEKLY." };

  let until: Date | undefined;
  if (parts.has("UNTIL")) {
    until = parseUntil(parts.get("UNTIL")!);
    if (!until) return { ok: false, message: "UNTIL must be a date such as 20261231 or 20261231T235900." };
  }

  return {
    ok: true,
    rule: { freq: freq as RRuleFrequency, interval, byDay, byHour, byMinute, byMonthDay, ...(until ? { until } : {}) },
  };
}

function list(value: string | undefined): string[] {
  return value ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
}

function parseInteger(value: string): number | undefined {
  return /^[+-]?\d+$/.test(value) ? Number(value) : undefined;
}

function numbers(value: string | undefined, min: number, max: number): number[] | string {
  const out: number[] = [];
  for (const item of list(value)) {
    const n = parseInteger(item);
    if (n === undefined || n < min || n > max) return `must be whole numbers from ${min} to ${max}.`;
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

function parseUntil(value: string): Date | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? "23", m[5] ?? "59", m[6] ?? "59"].map(Number) as [
    number, number, number, number, number, number,
  ];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(y, mo, 0).getDate() || h > 23 || mi > 59 || s > 59) return undefined;
  return m[7] ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : new Date(y, mo - 1, d, h, mi, s);
}

/**
 * Interval counting starts here when no anchor is given: a Monday midnight,
 * so a rule with no BYHOUR or BYMINUTE runs on the hour, at midnight, on
 * Mondays or on the 1st, and every-2-weeks parity is stable across launches.
 */
export function defaultAnchor(): Date {
  return new Date(2024, 0, 1, 0, 0, 0, 0);
}

/** About ten years of days: far enough for a 29 February rule, short enough never to hang. */
const SEARCH_DAYS = 3700;

/**
 * The first occurrence strictly after `after`, or undefined when there is
 * none within the search window. `anchor` is the rule's start, normally when
 * the automation was created: nothing occurs before it, INTERVAL counts from
 * it, and it supplies the time or day a rule leaves out.
 */
export function nextOccurrence(rule: RRule, after: Date, anchor: Date = defaultAnchor()): Date | undefined {
  const floor = Math.max(after.getTime() + 1, anchor.getTime());
  const start = new Date(floor);
  let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let i = 0; i < SEARCH_DAYS; i++) {
    if (rule.until && day.getTime() > rule.until.getTime()) return undefined;
    for (const time of timesOn(rule, day, anchor)) {
      if (time.getTime() < floor) continue;
      if (rule.until && time.getTime() > rule.until.getTime()) return undefined;
      return time;
    }
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }
  return undefined;
}

/** Occurrences in (from, to], at most `limit` of them. */
export function occurrencesBetween(rule: RRule, from: Date, to: Date, limit = 1000, anchor?: Date): Date[] {
  const out: Date[] = [];
  let cursor = from;
  while (out.length < limit) {
    const next = nextOccurrence(rule, cursor, anchor);
    if (!next || next.getTime() > to.getTime()) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

function utcDays(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function weekdayOf(date: Date): Weekday {
  return WEEKDAYS[(date.getDay() + 6) % 7]!;
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function dayEligible(rule: RRule, day: Date, anchor: Date): boolean {
  const dayDiff = utcDays(day) - utcDays(anchor);
  if (dayDiff < 0) return false;
  const weekday = weekdayOf(day);
  const monthDay = day.getDate();
  const fromEnd = monthDay - daysInMonth(day) - 1;

  if (rule.byDay.length > 0 && !rule.byDay.includes(weekday)) return false;
  if (rule.byMonthDay.length > 0 && !rule.byMonthDay.some((d) => d === monthDay || d === fromEnd)) return false;

  switch (rule.freq) {
    case "DAILY":
      return dayDiff % rule.interval === 0;
    case "WEEKLY": {
      if (rule.byDay.length === 0 && weekday !== weekdayOf(anchor)) return false;
      const weekStart = (d: Date) => utcDays(d) - WEEKDAYS.indexOf(weekdayOf(d));
      return ((weekStart(day) - weekStart(anchor)) / 7) % rule.interval === 0;
    }
    case "MONTHLY": {
      if (rule.byDay.length === 0 && rule.byMonthDay.length === 0 && monthDay !== anchor.getDate()) return false;
      const months = (day.getFullYear() - anchor.getFullYear()) * 12 + day.getMonth() - anchor.getMonth();
      return months % rule.interval === 0;
    }
    default:
      return true;
  }
}

function timesOn(rule: RRule, day: Date, anchor: Date): Date[] {
  if (!dayEligible(rule, day, anchor)) return [];
  const sub = rule.freq === "MINUTELY" || rule.freq === "HOURLY";
  const hours = rule.byHour.length > 0 ? rule.byHour : sub ? range(24) : [anchor.getHours()];
  const minutes = rule.byMinute.length > 0 ? rule.byMinute : rule.freq === "MINUTELY" ? range(60) : [anchor.getMinutes()];
  const dayDiff = utcDays(day) - utcDays(anchor);
  const out: Date[] = [];
  for (const hour of hours) {
    if (rule.freq === "HOURLY" && (dayDiff * 24 + hour - anchor.getHours()) % rule.interval !== 0) continue;
    for (const minute of minutes) {
      if (rule.freq === "MINUTELY") {
        const elapsed = dayDiff * 1440 + hour * 60 + minute - (anchor.getHours() * 60 + anchor.getMinutes());
        if (elapsed % rule.interval !== 0) continue;
      }
      const time = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
      // A wall-clock time skipped by a daylight-saving change does not occur.
      if (time.getHours() !== hour || time.getMinutes() !== minute) continue;
      out.push(time);
    }
  }
  return out;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

const DAY_NAMES: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function clock(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

function ordinal(n: number): string {
  if (n === -1) return "last day";
  if (n < 0) return `${ordinal(-n)} to last day`;
  const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}

function dayGroup(days: Weekday[]): "weekdays" | "weekends" | "every day" | undefined {
  const set = [...days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)).join(",");
  if (set === "MO,TU,WE,TH,FR") return "weekdays";
  if (set === "SA,SU") return "weekends";
  if (days.length === 7) return "every day";
  return undefined;
}

function plural(n: number, unit: string): string {
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
}

/** Plain words for a rule, such as "Weekdays at 9:00" or "Every 2 hours". */
export function describeRRule(rule: RRule, anchor?: Date): string {
  const sorted = [...rule.byDay].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
  const group = dayGroup(sorted);
  const names = sorted.map((d) => DAY_NAMES[d]);

  const hours = rule.byHour.length > 0 ? rule.byHour : anchor ? [anchor.getHours()] : [];
  const minutes = rule.byMinute.length > 0 ? rule.byMinute : anchor ? [anchor.getMinutes()] : hours.length > 0 ? [0] : [];
  const at = hours.length > 0 ? ` at ${joinWords(hours.flatMap((h) => minutes.map((m) => clock(h, m))))}` : "";

  let text: string;
  switch (rule.freq) {
    case "MINUTELY":
    case "HOURLY": {
      text = rule.freq === "MINUTELY" ? plural(rule.interval, "minute") : plural(rule.interval, "hour");
      if (rule.freq === "HOURLY" && rule.byMinute.length > 0) text += ` at ${joinWords(rule.byMinute.map((m) => `:${String(m).padStart(2, "0")}`))}`;
      if (group && group !== "every day") text += ` on ${group}`;
      else if (!group && names.length > 0) text += ` on ${joinWords(names.map((n) => `${n}s`))}`;
      if (rule.byHour.length > 0) text += ` ${hourWindow(rule.byHour)}`;
      break;
    }
    case "DAILY":
    case "WEEKLY": {
      if (rule.freq === "DAILY" && rule.interval > 1) text = `Every ${rule.interval} days`;
      else if (rule.freq === "WEEKLY" && rule.interval > 1) {
        const on = names.length > 0 ? names : anchor ? [DAY_NAMES[weekdayOf(anchor)]] : [];
        text = `Every ${rule.interval} weeks${on.length > 0 ? ` on ${joinWords(on)}` : ""}`;
      } else if (group === "weekdays") text = "Weekdays";
      else if (group === "weekends") text = "Weekends";
      else if (names.length > 0 && !group) text = `Every ${joinWords(names)}`;
      else if (rule.freq === "WEEKLY" && anchor) text = `Every ${DAY_NAMES[weekdayOf(anchor)]}`;
      else text = rule.freq === "WEEKLY" ? "Every week" : "Every day";
      if (rule.freq === "DAILY" && rule.interval > 1 && names.length > 0) text += ` on ${group ?? joinWords(names)}`;
      text += at;
      break;
    }
    case "MONTHLY": {
      text = rule.interval > 1 ? `Every ${rule.interval} months` : "Every month";
      const days = rule.byMonthDay.length > 0 ? rule.byMonthDay : names.length === 0 && anchor ? [anchor.getDate()] : [];
      if (days.length > 0) text += ` on the ${joinWords(days.map(ordinal))}`;
      if (names.length > 0) text += `${days.length > 0 ? " if a" : " on"} ${group ?? joinWords(names.map((n) => `${n}s`))}`;
      text += at;
      break;
    }
  }
  if (rule.until) text += ` until ${rule.until.getFullYear()}-${String(rule.until.getMonth() + 1).padStart(2, "0")}-${String(rule.until.getDate()).padStart(2, "0")}`;
  return text;
}

function hourWindow(hours: number[]): string {
  const contiguous = hours.every((h, i) => i === 0 || h === hours[i - 1]! + 1);
  if (contiguous && hours.length > 1) return `from ${clock(hours[0]!, 0)} to ${clock(hours[hours.length - 1]!, 59)}`;
  return `during the ${joinWords(hours.map((h) => clock(h, 0)))} hour${hours.length > 1 ? "s" : ""}`;
}
