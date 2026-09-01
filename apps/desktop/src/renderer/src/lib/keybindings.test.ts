import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  chordFor,
  chordSymbols,
  commandForEvent,
  conflictsFor,
  formatChord,
  matchesChord,
  parseChord,
} from "./keybindings.js";

function key(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: init.key,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
  } as KeyboardEvent;
}

describe("matchesChord", () => {
  it("matches the chord it describes", () => {
    expect(matchesChord(key({ key: "b", metaKey: true }), { key: "b", meta: true })).toBe(true);
  });

  it("treats Ctrl as the primary modifier too", () => {
    expect(matchesChord(key({ key: "b", ctrlKey: true }), { key: "b", meta: true })).toBe(true);
  });

  it("does not fire when an extra modifier is held", () => {
    // The bug this prevents: ⌘B also firing on ⌘⇧B, so one binding shadows
    // every chord built on top of it.
    expect(matchesChord(key({ key: "b", metaKey: true, shiftKey: true }), { key: "b", meta: true })).toBe(
      false,
    );
    expect(matchesChord(key({ key: "b", metaKey: true, altKey: true }), { key: "b", meta: true })).toBe(
      false,
    );
  });

  it("does not fire when a required modifier is missing", () => {
    expect(matchesChord(key({ key: "f", metaKey: true }), { key: "f", meta: true, shift: true })).toBe(
      false,
    );
  });

  it("is case insensitive on the key", () => {
    expect(matchesChord(key({ key: "B", metaKey: true }), { key: "b", meta: true })).toBe(true);
  });
});

describe("parse and format round-trip", () => {
  it("round-trips every default binding", () => {
    for (const command of COMMANDS) {
      const text = formatChord(command.chord);
      expect(parseChord(text), text).toEqual(command.chord);
    }
  });

  it("accepts the aliases people type", () => {
    expect(parseChord("cmd+k")).toEqual({ key: "k", meta: true });
    expect(parseChord("option+s")).toEqual({ key: "s", alt: true });
  });

  it("rejects an unknown modifier rather than dropping it", () => {
    expect(parseChord("hyper+k")).toBeUndefined();
    expect(parseChord("")).toBeUndefined();
  });
});

describe("commandForEvent", () => {
  it("finds a renderer command", () => {
    expect(commandForEvent(key({ key: "b", metaKey: true }), undefined)?.id).toBe("toggle-sidebar");
  });

  it("ignores menu-owned commands, which the main process fires first", () => {
    expect(commandForEvent(key({ key: "k", metaKey: true }), undefined)).toBeUndefined();
  });

  it("honours a user override in place of the default", () => {
    const keymap = { "toggle-sidebar": { key: "j", meta: true } };
    expect(commandForEvent(key({ key: "j", metaKey: true }), keymap)?.id).toBe("toggle-sidebar");
    expect(commandForEvent(key({ key: "b", metaKey: true }), keymap)).toBeUndefined();
  });
});

describe("conflictsFor", () => {
  it("reports a command already answering to that chord", () => {
    const clash = conflictsFor("search-files", { key: "b", meta: true }, undefined);
    expect(clash.map((command) => command.id)).toEqual(["toggle-sidebar"]);
  });

  it("does not report the command against itself", () => {
    expect(conflictsFor("toggle-sidebar", { key: "b", meta: true }, undefined)).toEqual([]);
  });

  it("compares against overrides, not just defaults", () => {
    const keymap = { "toggle-sidebar": { key: "j", meta: true } };
    expect(conflictsFor("search-files", { key: "b", meta: true }, keymap)).toEqual([]);
    expect(conflictsFor("search-files", { key: "j", meta: true }, keymap).map((c) => c.id)).toEqual([
      "toggle-sidebar",
    ]);
  });
});

describe("chordSymbols", () => {
  it("renders modifiers in a stable order", () => {
    expect(chordSymbols({ key: "f", meta: true, shift: true })).toEqual(["⇧", "⌘", "F"]);
  });

  it("names a key that has no glyph", () => {
    expect(chordSymbols({ key: " " })).toEqual(["Space"]);
    expect(chordSymbols({ key: "enter" })).toEqual(["enter"]);
  });
});

describe("chordFor", () => {
  it("falls back to the default when no override exists", () => {
    const command = COMMANDS.find((c) => c.id === "toggle-sidebar")!;
    expect(chordFor(command, {})).toEqual(command.chord);
  });
});

describe("the registry itself", () => {
  it("ships without a conflict between two defaults", () => {
    for (const command of COMMANDS) {
      expect(conflictsFor(command.id, command.chord, undefined), command.id).toEqual([]);
    }
  });
});
