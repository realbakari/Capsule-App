import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@capsule/shared";
import {
  foldedTurnIds,
  foldedTurnLabel,
  formatDuration,
  turnDurationMs,
  turnsFromMessages,
} from "./turns.js";

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

describe("turn offsets", () => {
  /**
   * Mirrors the offset map Conversation builds. The point of the test is the
   * contract that map has to honour: the flat index of a message must be its
   * turn's offset plus its position, which is what tells a row whether it
   * arrived after the thread was opened.
   */
  function offsetsFor(turns: ReturnType<typeof turnsFromMessages>) {
    const offsets = new Map<string, number>();
    let total = 0;
    for (const turn of turns) {
      offsets.set(turn.id, total);
      total += turn.messages.length;
    }
    return offsets;
  }

  it("gives every message the index it has in the flat list", () => {
    const messages = [
      msg("m1", "user", "a"),
      msg("m2", "assistant", "b"),
      msg("m3", "user", "c"),
      msg("m4", "assistant", "d"),
      msg("m5", "assistant", "e"),
    ];
    const turns = turnsFromMessages(messages);
    const offsets = offsetsFor(turns);

    const flat: string[] = [];
    for (const turn of turns) {
      turn.messages.forEach((message, index) => {
        flat[(offsets.get(turn.id) ?? 0) + index] = message.id;
      });
    }
    expect(flat).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });

  it("covers every message exactly once", () => {
    const messages = Array.from({ length: 20 }, (_, index) =>
      msg(`m${index}`, index % 3 === 0 ? "user" : "assistant", "x"),
    );
    const turns = turnsFromMessages(messages);
    const offsets = offsetsFor(turns);
    const seen = new Set<number>();
    for (const turn of turns) {
      turn.messages.forEach((_, index) => seen.add((offsets.get(turn.id) ?? 0) + index));
    }
    expect(seen.size).toBe(messages.length);
    expect(Math.max(...seen)).toBe(messages.length - 1);
  });
});

describe("turnDurationMs and formatDuration", () => {
  const at = (id: string, role: ChatMessage["role"], iso: string): ChatMessage => ({
    ...msg(id, role, "x"),
    createdAt: iso,
  });

  it("measures from the prompt to the last message", () => {
    const turn = turnsFromMessages([
      at("m1", "user", "2026-09-01T10:00:00.000Z"),
      at("m2", "assistant", "2026-09-01T10:04:15.000Z"),
    ])[0]!;
    expect(turnDurationMs(turn)).toBe(255_000);
    expect(formatDuration(turnDurationMs(turn)!)).toBe("4m 15s");
  });

  it("says nothing for a turn that never ran", () => {
    const turn = turnsFromMessages([at("m1", "user", "2026-09-01T10:00:00.000Z")])[0]!;
    expect(turnDurationMs(turn)).toBeUndefined();
  });

  it("says nothing under a second, rather than showing 0s", () => {
    const turn = turnsFromMessages([
      at("m1", "user", "2026-09-01T10:00:00.000Z"),
      at("m2", "assistant", "2026-09-01T10:00:00.400Z"),
    ])[0]!;
    expect(turnDurationMs(turn)).toBeUndefined();
  });

  it("ignores a clock that ran backwards", () => {
    const turn = turnsFromMessages([
      at("m1", "user", "2026-09-01T10:05:00.000Z"),
      at("m2", "assistant", "2026-09-01T10:00:00.000Z"),
    ])[0]!;
    expect(turnDurationMs(turn)).toBeUndefined();
  });

  it("ignores an unparseable timestamp", () => {
    const turn = turnsFromMessages([
      at("m1", "user", "not a date"),
      at("m2", "assistant", "2026-09-01T10:00:00.000Z"),
    ])[0]!;
    expect(turnDurationMs(turn)).toBeUndefined();
  });

  it("formats coarsely at every scale", () => {
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(3_900_000)).toBe("1h 5m");
  });
});
