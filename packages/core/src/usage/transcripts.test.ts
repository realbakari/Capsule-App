import { describe, expect, it } from "vitest";
import {
  addTotals,
  dedupe,
  EMPTY_TOTALS,
  parseClaudeLine,
  parseCodexLine,
  sumRecords,
  totalTokens,
  type UsageRecord,
} from "./transcripts.js";

const claudeLine = (over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) =>
  JSON.stringify({
    timestamp: "2026-09-01T10:00:00.000Z",
    sessionId: "sess-1",
    requestId: "req-1",
    message: {
      id: "msg-1",
      model: "claude-opus-5",
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 50,
        output_tokens: 200,
        ...usage,
      },
      ...over,
    },
  });

const codexLine = (usage: Record<string, unknown> = {}) =>
  JSON.stringify({
    timestamp: "2026-09-01T10:00:00.000Z",
    type: "event_msg",
    payload: {
      info: {
        model: "gpt-5.6",
        last_token_usage: {
          input_tokens: 13334,
          cached_input_tokens: 9600,
          output_tokens: 270,
          reasoning_output_tokens: 54,
          total_tokens: 13604,
          ...usage,
        },
        total_token_usage: { input_tokens: 999999, output_tokens: 999999 },
      },
    },
  });

describe("parseClaudeLine", () => {
  it("reads the disjoint buckets as written", () => {
    const record = parseClaudeLine(claudeLine())!;
    expect(record.totals).toEqual({
      input: 100,
      cachedInput: 900,
      cacheWrite: 50,
      output: 200,
      reasoning: 0,
    });
    expect(record.model).toBe("claude-opus-5");
    expect(record.at).toBe(Date.parse("2026-09-01T10:00:00.000Z"));
  });

  it("carries the message id so repeats can be dropped", () => {
    expect(parseClaudeLine(claudeLine())!.dedupeKey).toBe("msg-1");
  });

  it("skips the synthetic model, which is not billed", () => {
    expect(parseClaudeLine(claudeLine({ model: "<synthetic>" }))).toBeUndefined();
  });

  it("skips a line with no tokens rather than emitting a zero row", () => {
    const empty = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 };
    expect(parseClaudeLine(claudeLine({}, empty))).toBeUndefined();
  });

  it("ignores lines that are not usage, and malformed JSON", () => {
    expect(parseClaudeLine('{"type":"user","content":"hi"}')).toBeUndefined();
    expect(parseClaudeLine("not json")).toBeUndefined();
    expect(parseClaudeLine("")).toBeUndefined();
  });

  it("treats a negative or non-numeric count as zero", () => {
    const record = parseClaudeLine(claudeLine({}, { input_tokens: -5, output_tokens: "many" }))!;
    expect(record.totals.input).toBe(0);
    expect(record.totals.output).toBe(0);
  });
});

describe("parseCodexLine", () => {
  it("un-nests the buckets so a total is not double counted", () => {
    // Codex reports cached inside input and reasoning inside output.
    const record = parseCodexLine(codexLine())!;
    expect(record.totals).toEqual({
      input: 13334 - 9600,
      cachedInput: 9600,
      cacheWrite: 0,
      output: 270 - 54,
      reasoning: 54,
    });
    // The un-nested buckets still sum to what Codex called the total.
    expect(totalTokens(record.totals)).toBe(13604);
  });

  it("uses the per-turn figure, not the session running total", () => {
    // total_token_usage on the same line is 999999; using it would multiply a
    // session's usage by roughly its number of turns.
    expect(totalTokens(parseCodexLine(codexLine())!.totals)).toBeLessThan(20_000);
  });

  it("clamps a nested count that exceeds its parent", () => {
    const record = parseCodexLine(codexLine({ cached_input_tokens: 99_999 }))!;
    expect(record.totals.input).toBe(0);
    expect(record.totals.cachedInput).toBe(13334);
  });

  it("falls back to the session id it was given", () => {
    expect(parseCodexLine(codexLine(), "sess-9")!.sessionId).toBe("sess-9");
  });

  it("ignores lines with no last_token_usage", () => {
    expect(parseCodexLine('{"type":"response_item","payload":{}}')).toBeUndefined();
    expect(parseCodexLine("{")).toBeUndefined();
  });
});

describe("dedupe and sumRecords", () => {
  const record = (key: string | undefined, output: number): UsageRecord => ({
    provider: "claude",
    at: 0,
    model: "m",
    sessionId: "s",
    totals: { ...EMPTY_TOTALS, output },
    dedupeKey: key,
  });

  it("counts one billed request once, however many lines describe it", () => {
    const rows = [record("a", 10), record("a", 10), record("a", 10), record("b", 5)];
    expect(sumRecords(rows).output).toBe(15);
    expect(dedupe(rows)).toHaveLength(2);
  });

  it("keeps records that carry no key, which are inherently unique", () => {
    expect(sumRecords([record(undefined, 3), record(undefined, 4)]).output).toBe(7);
  });

  it("does not let two providers collide on the same key", () => {
    const claude = record("shared", 10);
    const codex: UsageRecord = { ...claude, provider: "codex" };
    expect(sumRecords([claude, codex]).output).toBe(20);
  });
});

describe("totals arithmetic", () => {
  it("adds bucket by bucket", () => {
    const a = { input: 1, cachedInput: 2, cacheWrite: 3, output: 4, reasoning: 5 };
    expect(addTotals(a, a)).toEqual({ input: 2, cachedInput: 4, cacheWrite: 6, output: 8, reasoning: 10 });
    expect(totalTokens(a)).toBe(15);
  });
});
