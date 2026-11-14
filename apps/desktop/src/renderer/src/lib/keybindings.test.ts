import { describe, expect, it } from "vitest";
import { createChordMatcher, parseChordSequence, parseKeybindingsFile, type ChordSequence } from "@capsule/shared";
import { actionLabel, chordFromEvent, chordSymbols, effectiveKeymap, registryRows, sequenceStartsWith } from "./keybindings.js";

const seq = (text: string): ChordSequence => {
  const parsed = parseChordSequence(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sequence;
};
const press = (key: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key, metaKey: Boolean(mods.meta), ctrlKey: Boolean(mods.ctrl), shiftKey: Boolean(mods.shift), altKey: Boolean(mods.alt),
});

describe("the effective keymap", () => {
  it("keeps today's defaults when keybindings.json is empty", () => {
    const keys = Object.fromEntries(effectiveKeymap([]).map((b) => [b.action, b.sequence]));
    expect(keys["toggle-sidebar"]).toEqual(seq("cmd+b"));
    expect(keys["next-conversation"]).toEqual(seq("cmd+tab"));
    expect(keys.palette).toBeUndefined();
  });

  it("lays a chord, a rebinding and an unbind from the file over the defaults", () => {
    const { entries } = parseKeybindingsFile([{ bindings: { "cmd+g cmd+t": "toggle-terminal", "cmd+j": "toggle-sidebar", "cmd+p": null } }]);
    const bindings = effectiveKeymap(entries);
    const matcher = createChordMatcher(bindings);
    expect(matcher.feed({ ...press("g", { meta: true }), time: 0 })).toMatchObject({ kind: "pending" });
    expect(matcher.feed({ ...press("t", { meta: true }), time: 500 })).toMatchObject({ kind: "match", action: "toggle-terminal" });
    expect(matcher.feed({ ...press("j", { meta: true }), time: 600 })).toMatchObject({ kind: "match", action: "toggle-sidebar" });
    expect(matcher.feed({ ...press("b", { meta: true }), time: 700 })).toEqual({ kind: "none" });
    expect(matcher.feed({ ...press("p", { meta: true }), time: 800 })).toEqual({ kind: "none" });
  });

  it("lists every registry command once, menu commands without editable keys", () => {
    const rows = registryRows(effectiveKeymap([]));
    expect(rows.find((row) => row.command.id === "palette")?.bindings).toEqual([]);
    expect(rows.find((row) => row.command.id === "toggle-sidebar")?.bindings).toHaveLength(1);
  });
});

describe("recording and display", () => {
  it("records ⌘ as the primary modifier on macOS and keeps Control as itself", () => {
    expect(chordFromEvent(press("K", { meta: true, shift: true }), true)).toEqual({ key: "k", meta: true, shift: true });
    expect(chordFromEvent(press("a", { ctrl: true }), true)).toEqual({ key: "a", ctrl: true });
    expect(chordFromEvent(press("a", { ctrl: true }), false)).toEqual({ key: "a", meta: true });
    expect(chordFromEvent(press("Shift", { shift: true }), true)).toBeUndefined();
  });

  it("finds bindings by the keys that start them", () => {
    expect(sequenceStartsWith(seq("cmd+g cmd+t"), seq("cmd+g"))).toBe(true);
    expect(sequenceStartsWith(seq("cmd+g"), seq("cmd+g cmd+t"))).toBe(false);
    expect(sequenceStartsWith(seq("cmd+shift+g"), seq("cmd+g"))).toBe(false);
  });

  it("shows symbols, and Tab with Control because ⌘Tab belongs to the system", () => {
    expect(chordSymbols({ key: "k", meta: true, shift: true })).toEqual(["⇧", "⌘", "K"]);
    expect(chordSymbols({ key: "tab", meta: true })).toEqual(["⌃", "Tab"]);
  });

  it("names actions of every kind", () => {
    expect(actionLabel("toggle-sidebar")).toBe("Toggle sidebar");
    expect(actionLabel("command:review", [{ name: "review", description: "Review the diff" } as never])).toBe("/review · Review the diff");
    expect(actionLabel("action:dev")).toBe("Run dev");
    expect(actionLabel("profile:fast")).toBe("Profile fast");
  });
});
