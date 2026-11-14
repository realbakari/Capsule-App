import { describe, expect, it } from "vitest";
import type { Run } from "@capsule/shared";
import {
  ignoreWhitespaceFor,
  parseScopeValue,
  promptExcerpt,
  rememberIgnoreWhitespace,
  rememberScope,
  rememberedScope,
  reviewTurns,
  scopeValue,
} from "./review-scope";

const run = (id: string, createdAt: string, prompt: string, checkpointRef?: string): Run =>
  ({ id, createdAt, updatedAt: createdAt, prompt, checkpointRef, sessionId: "s", projectId: "p", agentId: "a", status: "completed" }) as Run;

describe("review turns", () => {
  it("numbers every turn from the first and lists checkpointed ones newest first", () => {
    const turns = reviewTurns([
      run("c", "2026-01-03", "third", "refs/x/c"),
      run("a", "2026-01-01", "first  prompt\nwith lines", "refs/x/a"),
      run("b", "2026-01-02", "second, no checkpoint"),
    ]);
    expect(turns.map((turn) => turn.label)).toEqual(["Turn 3 · third", "Turn 1 · first prompt with lines"]);
  });

  it("shortens long prompts and names empty ones", () => {
    expect(promptExcerpt("x".repeat(80))).toHaveLength(48);
    expect(promptExcerpt("   ")).toBe("Untitled turn");
  });

  it("round-trips a scope through the select value", () => {
    expect(parseScopeValue(scopeValue({ kind: "turn", runId: "r1" }))).toEqual({ kind: "turn", runId: "r1" });
    expect(parseScopeValue("uncommitted")).toEqual({ kind: "uncommitted" });
    expect(parseScopeValue("turn:")).toEqual({ kind: "uncommitted" });
  });

  it("remembers the scope and whitespace choice per thread", () => {
    rememberScope("t1", { kind: "turn", runId: "r1" });
    expect(rememberedScope("t1")).toEqual({ kind: "turn", runId: "r1" });
    expect(rememberedScope("t2")).toEqual({ kind: "uncommitted" });
    rememberScope("t1", { kind: "uncommitted" });
    expect(rememberedScope("t1")).toEqual({ kind: "uncommitted" });
    rememberIgnoreWhitespace("t1", true, false);
    expect(ignoreWhitespaceFor("t1", false)).toBe(true);
    expect(ignoreWhitespaceFor("t2", false)).toBe(false);
    // Matching the setting again drops the override, so a later setting change applies.
    rememberIgnoreWhitespace("t1", false, false);
    expect(ignoreWhitespaceFor("t1", true)).toBe(true);
  });
});
