import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@capsule/shared";
import { foldedTurnIds, foldedTurnLabel, turnsFromMessages } from "./turns.js";

const msg = (
  id: string,
  role: ChatMessage["role"],
  content: string,
  kind?: "steer",
): ChatMessage => ({
  id, sessionId: "s1", role, content,
  ...(kind ? { kind } : {}),
  createdAt: "2026-08-26T00:00:00.000Z",
});

describe("turnsFromMessages", () => {
  it("groups each prompt with everything that answered it", () => {
    const turns = turnsFromMessages([
      msg("1", "user", "first"), msg("2", "assistant", "reply a"),
      msg("3", "user", "second"), msg("4", "assistant", "reply b"), msg("5", "assistant", "more"),
    ]);
    expect(turns.map((t) => t.messages.length)).toEqual([2, 3]);
    expect(turns.map((t) => t.prompt?.content)).toEqual(["first", "second"]);
  });

  it("keeps a steer inside the open turn rather than starting a new one", () => {
    // A steer redirects the turn in flight; it is not a new exchange.
    const turns = turnsFromMessages([
      msg("1", "user", "do it"), msg("2", "assistant", "working"),
      msg("3", "user", "focus on the header", "steer"), msg("4", "assistant", "done"),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]?.messages.map((m) => m.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("tolerates a transcript that opens with an assistant message", () => {
    const turns = turnsFromMessages([msg("1", "assistant", "hello"), msg("2", "user", "hi")]);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.prompt).toBeUndefined();
  });

  it("returns nothing for an empty transcript", () => {
    expect(turnsFromMessages([])).toEqual([]);
  });
});

describe("foldedTurnIds", () => {
  const turns = turnsFromMessages([
    msg("1", "user", "one"), msg("1b", "assistant", "a"),
    msg("2", "user", "two"), msg("2b", "assistant", "b"),
    msg("3", "user", "three"), msg("3b", "assistant", "c"),
    msg("4", "user", "four"), msg("4b", "assistant", "d"),
  ]);

  it("keeps the newest turns open and folds the rest", () => {
    expect([...foldedTurnIds(turns, 2, new Set())]).toEqual(["1", "2"]);
  });

  it("never folds a turn the reader opened", () => {
    expect([...foldedTurnIds(turns, 2, new Set(["1"]))]).toEqual(["2"]);
  });

  it("folds nothing when everything fits", () => {
    expect(foldedTurnIds(turns, 10, new Set()).size).toBe(0);
  });

  it("leaves single-message turns alone — folding saves no rows", () => {
    const singles = turnsFromMessages([msg("1", "user", "a"), msg("2", "user", "b"), msg("3", "user", "c")]);
    expect(foldedTurnIds(singles, 1, new Set()).size).toBe(0);
  });
});

describe("foldedTurnLabel", () => {
  it("uses the prompt, collapsing whitespace", () => {
    const [turn] = turnsFromMessages([msg("1", "user", "  review   the\nREADME "), msg("2", "assistant", "ok")]);
    expect(foldedTurnLabel(turn!)).toBe("review the README");
  });

  it("truncates a long prompt", () => {
    const [turn] = turnsFromMessages([msg("1", "user", "x".repeat(200)), msg("2", "assistant", "ok")]);
    expect(foldedTurnLabel(turn!, 20)).toBe(`${"x".repeat(19)}…`);
  });

  it("falls back when a turn has no prompt", () => {
    const [turn] = turnsFromMessages([msg("1", "assistant", "   ")]);
    expect(foldedTurnLabel(turn!)).toBe("Earlier turn");
  });
});
