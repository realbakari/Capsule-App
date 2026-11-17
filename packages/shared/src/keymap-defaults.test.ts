import { describe, expect, it } from "vitest";

import { keymapConflicts, parseChordSequence, parseKeybindingsFile, resolveKeymap } from "./keymap.js";
import { defaultBindings, KEY_COMMAND_GROUPS, KEY_COMMANDS, keybindingWarnings, takenByMenu } from "./keymap-defaults.js";

describe("the default keymap", () => {
  it("parses every command's keys and leaves menu-owned ones to the menu", () => {
    const ids = defaultBindings().map((b) => b.id);
    expect(ids).toContain("toggle-sidebar");
    expect(ids).not.toContain("palette");
    expect(KEY_COMMANDS.filter((c) => c.keys && !c.menuOwned)).toHaveLength(ids.length);
  });

  it("has no two defaults on one key, and none the menu takes first, on either platform", () => {
    const defaults = resolveKeymap(defaultBindings(), []);
    for (const mac of [true, false]) {
      expect(keymapConflicts(defaults, mac)).toEqual([]);
      expect(defaults.filter((b) => takenByMenu(b.sequence, mac)).map((b) => b.action), mac ? "macOS" : "elsewhere").toEqual([]);
    }
  });

  it("puts every command in a known group", () => {
    for (const command of KEY_COMMANDS) expect(KEY_COMMAND_GROUPS, command.id).toContain(command.group);
  });

  it("covers the moves people expect a keyboard to make", () => {
    const ids = defaultBindings().map((b) => b.id);
    for (const id of ["toggle-sidebar", "toggle-terminal", "toggle-inspector", "open-review", "search-files", "find-in-thread", "next-conversation", "previous-conversation", "previous-turn", "next-turn", "stop-turn", "focus-composer", "open-model", "open-mode", "open-effort", "show-shortcuts"]) {
      expect(ids, id).toContain(id);
    }
  });
});

describe("takenByMenu", () => {
  const keys = (text: string) => {
    const parsed = parseChordSequence(text);
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.sequence;
  };

  it("knows the developer tools and full screen keys differ by platform", () => {
    expect(takenByMenu(keys("cmd+shift+i"), false)).toBe(true);
    expect(takenByMenu(keys("cmd+shift+i"), true)).toBe(false);
    expect(takenByMenu(keys("cmd+alt+i"), true)).toBe(true);
    expect(takenByMenu(keys("f11"), false)).toBe(true);
    expect(takenByMenu(keys("ctrl+w"), false)).toBe(true);
    expect(takenByMenu(keys("ctrl+w"), true)).toBe(false);
  });
});

describe("keybindingWarnings", () => {
  it("names menu keys, fixed and unknown actions, missing commands and profiles", () => {
    const { entries } = parseKeybindingsFile([
      { bindings: { "cmd+k cmd+t": "toggle-terminal", "cmd+g": "palette", "cmd+e": "nope", "cmd+u": "command:ship", "cmd+y": "command:review", "alt+p": "profile:fast", "cmd+w": null } },
    ]);
    const warnings = keybindingWarnings(entries, { commands: ["review"], profiles: ["reviewer"], mac: true });
    expect(warnings.map((w) => w.key)).toEqual([
      'global "cmd+k cmd+t"',
      'global "cmd+g"',
      'global "cmd+e"',
      'global "cmd+u"',
      'global "alt+p"',
      'global "cmd+w"',
    ]);
    expect(warnings[4]!.message).toBe("There is no profile named fast.");
  });
});
