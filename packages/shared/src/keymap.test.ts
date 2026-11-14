import { describe, expect, it } from "vitest";

import {
  chordMatchesEvent,
  createChordMatcher,
  formatChordSequence,
  keymapConflicts,
  parseChordSequence,
  parseKeybindingsFile,
  parseKeymapAction,
  resolveKeymap,
  type ChordSequence,
  type DefaultBinding,
} from "./keymap.js";

function seq(text: string): ChordSequence {
  const parsed = parseChordSequence(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sequence;
}

function press(key: string, mods: { cmd?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}, time = 0) {
  return { key, metaKey: Boolean(mods.cmd), ctrlKey: Boolean(mods.ctrl), shiftKey: Boolean(mods.shift), altKey: Boolean(mods.alt), time };
}

describe("parseChordSequence", () => {
  it("reads modifiers in any spelling into the renderer's chord shape", () => {
    expect(seq("Cmd+Shift+K")).toEqual([{ key: "k", meta: true, shift: true }]);
    expect(seq("meta+option+s")).toEqual([{ key: "s", meta: true, alt: true }]);
    expect(seq("control+`")).toEqual([{ key: "`", ctrl: true }]);
    expect(seq("cmd+k cmd+r")).toEqual([{ key: "k", meta: true }, { key: "r", meta: true }]);
  });

  it("names keys that cannot be written literally", () => {
    expect(seq("ctrl+space")).toEqual([{ key: " ", ctrl: true }]);
    expect(seq("cmd++")).toEqual([{ key: "+", meta: true }]);
    expect(seq("esc")).toEqual([{ key: "escape" }]);
  });

  it("refuses unknown modifiers, missing keys and long sequences", () => {
    expect(parseChordSequence("hyper+k").ok).toBe(false);
    expect(parseChordSequence("cmd+shift").ok).toBe(false);
    expect(parseChordSequence("cmd+").ok).toBe(false);
    expect(parseChordSequence("a b c").ok).toBe(false);
    expect(parseChordSequence("  ").ok).toBe(false);
  });

  it("formats one canonical spelling", () => {
    expect(formatChordSequence(seq("shift+meta+k  control+alt+space"))).toBe("cmd+shift+k ctrl+alt+space");
    expect(formatChordSequence(seq("cmd++"))).toBe("cmd+plus");
  });
});

describe("chordMatchesEvent", () => {
  it("treats cmd as either Command or Control, matching modifiers exactly", () => {
    const [chord] = seq("cmd+b");
    expect(chordMatchesEvent(chord!, press("b", { cmd: true }))).toBe(true);
    expect(chordMatchesEvent(chord!, press("B", { ctrl: true }))).toBe(true);
    expect(chordMatchesEvent(chord!, press("b", { cmd: true, shift: true }))).toBe(false);
    expect(chordMatchesEvent(chord!, press("b"))).toBe(false);
  });

  it("treats ctrl as the physical Control key only", () => {
    const [chord] = seq("ctrl+`");
    expect(chordMatchesEvent(chord!, press("`", { ctrl: true }))).toBe(true);
    expect(chordMatchesEvent(chord!, press("`", { cmd: true }))).toBe(false);
    expect(chordMatchesEvent(seq("ctrl+cmd+f")[0]!, press("f", { ctrl: true, cmd: true }))).toBe(true);
  });
});

describe("parseKeybindingsFile", () => {
  it("reads blocks, unbinds and namespaced actions", () => {
    const { entries, problems } = parseKeybindingsFile([
      { context: "composer", bindings: { "cmd+enter": "command:review", "cmd+k": null } },
      { bindings: { "cmd+k cmd+r": "profile:fast" } },
    ]);
    expect(problems).toEqual([]);
    expect(entries).toEqual([
      { context: "composer", sequence: seq("cmd+enter"), action: "command:review" },
      { context: "composer", sequence: seq("cmd+k"), action: null },
      { context: "global", sequence: seq("cmd+k cmd+r"), action: "profile:fast" },
    ]);
  });

  it("skips bad entries with a locator and keeps the rest", () => {
    const { entries, problems } = parseKeybindingsFile([
      { context: "sidebar", bindings: { "cmd+x": "a" } },
      { context: "global", bindings: { "hyper+x": "a", "cmd+y": 3, "cmd+z": "command:", "cmd+u": "undo" } },
      "nope",
    ]);
    expect(entries).toEqual([{ context: "global", sequence: seq("cmd+u"), action: "undo" }]);
    expect(problems.map((p) => p.key)).toEqual([
      "[0].context",
      '[1].bindings["hyper+x"]',
      '[1].bindings["cmd+y"]',
      '[1].bindings["cmd+z"]',
      "[2]",
    ]);
    expect(parseKeybindingsFile({}).problems).toHaveLength(1);
  });

  it("splits namespaced actions", () => {
    expect(parseKeymapAction("command:git:commit")).toEqual({ namespace: "command", name: "git:commit" });
    expect(parseKeymapAction("toggle-sidebar")).toEqual({ namespace: undefined, name: "toggle-sidebar" });
  });
});

const DEFAULTS: DefaultBinding[] = [
  { id: "toggle-sidebar", context: "global", sequence: seq("cmd+b") },
  { id: "search-files", context: "global", sequence: seq("cmd+p") },
  { id: "palette", context: "global", sequence: seq("cmd+k") },
  { id: "send", context: "composer", sequence: seq("enter") },
];

function table(bindings: ReturnType<typeof resolveKeymap>) {
  return bindings.map((b) => `${b.context} ${formatChordSequence(b.sequence)} ${b.action} ${b.source}`).sort();
}

describe("resolveKeymap", () => {
  it("moves an action to the user's keys", () => {
    const { entries } = parseKeybindingsFile([{ context: "global", bindings: { "cmd+shift+b": "toggle-sidebar" } }]);
    const effective = table(resolveKeymap(DEFAULTS, entries));
    expect(effective).toContain("global cmd+shift+b toggle-sidebar user");
    expect(effective.some((line) => line.startsWith("global cmd+b "))).toBe(false);
  });

  it("unbinds a default sequence in its context only", () => {
    const { entries } = parseKeybindingsFile([
      { context: "global", bindings: { "cmd+p": null } },
      { context: "composer", bindings: { "cmd+b": null } },
    ]);
    const effective = table(resolveKeymap(DEFAULTS, entries));
    expect(effective.some((line) => line.includes("search-files"))).toBe(false);
    expect(effective).toContain("global cmd+b toggle-sidebar default");
  });

  it("takes a sequence from the action that held it", () => {
    const { entries } = parseKeybindingsFile([{ bindings: { "cmd+p": "command:plan" } }]);
    const effective = table(resolveKeymap(DEFAULTS, entries));
    expect(effective).toContain("global cmd+p command:plan user");
    expect(effective.some((line) => line.includes("search-files"))).toBe(false);
  });

  it("lets a later entry win", () => {
    const { entries } = parseKeybindingsFile([{ bindings: { "cmd+j": "a" } }, { bindings: { "cmd+j": null } }]);
    expect(table(resolveKeymap([], entries))).toEqual([]);
  });
});

describe("keymapConflicts", () => {
  it("finds a single chord that shadows a sequence and one sequence bound twice", () => {
    const bindings = resolveKeymap(
      [
        { id: "palette", context: "global", sequence: seq("cmd+k") },
        { id: "reload", context: "global", sequence: seq("cmd+k cmd+r") },
        { id: "a", context: "review", sequence: seq("j") },
        { id: "b", context: "review", sequence: seq("j") },
        { id: "c", context: "composer", sequence: seq("cmd+k cmd+r") },
      ],
      [],
    );
    expect(keymapConflicts(bindings)).toEqual([
      { context: "global", kind: "prefix", sequence: "cmd+k", actions: ["palette", "reload"] },
      { context: "review", kind: "duplicate", sequence: "j", actions: ["a", "b"] },
    ]);
  });
});

describe("createChordMatcher", () => {
  const bindings = resolveKeymap(
    [
      { id: "toggle-sidebar", context: "global", sequence: seq("cmd+b") },
      { id: "reload-config", context: "global", sequence: seq("cmd+k cmd+r") },
      { id: "send", context: "composer", sequence: seq("cmd+enter") },
      { id: "bold", context: "composer", sequence: seq("cmd+b") },
    ],
    [],
  );

  it("matches a single chord", () => {
    expect(createChordMatcher(bindings).feed(press("b", { cmd: true }))).toMatchObject({ kind: "match", action: "toggle-sidebar" });
    expect(createChordMatcher(bindings).feed(press("x", { cmd: true }))).toEqual({ kind: "none" });
  });

  it("completes a sequence inside the window, ignoring bare modifier presses", () => {
    const matcher = createChordMatcher(bindings);
    expect(matcher.feed(press("k", { cmd: true }, 1000))).toEqual({ kind: "pending", prefix: { key: "k", meta: true } });
    expect(matcher.feed(press("Meta", { cmd: true }, 1200))).toMatchObject({ kind: "pending" });
    expect(matcher.feed(press("r", { cmd: true }, 2400))).toMatchObject({ kind: "match", action: "reload-config" });
  });

  it("drops the first chord after 1.5 seconds", () => {
    const matcher = createChordMatcher(bindings);
    matcher.feed(press("k", { cmd: true }, 1000));
    expect(matcher.feed(press("r", { cmd: true }, 2600))).toEqual({ kind: "none" });
  });

  it("reads a wrong second chord as a fresh one", () => {
    const matcher = createChordMatcher(bindings);
    matcher.feed(press("k", { cmd: true }, 0));
    expect(matcher.feed(press("b", { cmd: true }, 100))).toMatchObject({ kind: "match", action: "toggle-sidebar" });
    expect(matcher.feed(press("r", { cmd: true }, 200))).toEqual({ kind: "none" });
  });

  it("asks the focused context first and falls back to global", () => {
    const matcher = createChordMatcher(bindings);
    matcher.setContexts(["composer"]);
    expect(matcher.feed(press("b", { cmd: true }))).toMatchObject({ kind: "match", action: "bold", context: "composer" });
    expect(matcher.feed(press("enter", { cmd: true }))).toMatchObject({ action: "send" });
    matcher.feed(press("k", { cmd: true }, 0));
    expect(matcher.feed(press("r", { cmd: true }, 10))).toMatchObject({ action: "reload-config", context: "global" });
    matcher.setContexts(["review"]);
    expect(matcher.feed(press("enter", { cmd: true }))).toEqual({ kind: "none" });
    expect(matcher.feed(press("b", { cmd: true }))).toMatchObject({ action: "toggle-sidebar" });
  });
});
