import { describe, expect, it } from "vitest";

import { parseKeybindingsFile, resolveKeymap } from "./keymap.js";
import { defaultBindings, KEY_COMMANDS, keybindingWarnings } from "./keymap-defaults.js";

describe("the default keymap", () => {
  it("parses every command's keys and leaves menu-owned ones to the menu", () => {
    const ids = defaultBindings().map((b) => b.id);
    expect(ids).toContain("toggle-sidebar");
    expect(ids).not.toContain("palette");
    expect(KEY_COMMANDS.filter((c) => c.keys && !c.menuOwned)).toHaveLength(ids.length);
  });

  it("has no two defaults on one key", () => {
    const keys = resolveKeymap(defaultBindings(), []).map((b) => `${b.context} ${JSON.stringify(b.sequence)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("keybindingWarnings", () => {
  it("names menu keys, fixed and unknown actions, missing commands and profiles", () => {
    const { entries } = parseKeybindingsFile([
      { bindings: { "cmd+k cmd+t": "toggle-terminal", "cmd+g": "palette", "cmd+e": "nope", "cmd+u": "command:ship", "cmd+y": "command:review", "alt+p": "profile:fast", "cmd+w": null } },
    ]);
    const warnings = keybindingWarnings(entries, { commands: ["review"] });
    expect(warnings.map((w) => w.key)).toEqual([
      'global "cmd+k cmd+t"',
      'global "cmd+g"',
      'global "cmd+e"',
      'global "cmd+u"',
      'global "alt+p"',
      'global "cmd+w"',
    ]);
    expect(warnings[4]!.message).toMatch(/not available yet/);
  });
});
