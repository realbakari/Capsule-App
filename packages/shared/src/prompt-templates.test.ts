import { describe, expect, it } from "vitest";
import { fillTemplate, normalizePromptTemplates, templateCommand, templateVariables } from "./prompt-templates.js";
import { parseProjectFile } from "./project-file.js";
import { normalizeCapsuleSettings } from "./runtime.js";

describe("prompt templates", () => {
  it("reads free-text and choice blanks once each, in order", () => {
    expect(templateVariables("Review {{file}} for {{focus:security|speed| security }} then {{file}} again; {{ tone }}")).toEqual([
      { name: "file" },
      { name: "focus", choices: ["security", "speed"] },
      { name: "tone" },
    ]);
    expect(templateVariables("No blanks, just {braces} and {{ }}")).toEqual([]);
  });

  it("fills every blank and checks choices", () => {
    expect(fillTemplate("Fix {{bug}} in {{area:ui|api}}. {{bug}} again.", { bug: "the crash", area: "api" })).toBe("Fix the crash in api. the crash again.");
    expect(() => fillTemplate("Fix {{bug}}", {})).toThrow("Fill in bug.");
    expect(() => fillTemplate("In {{area:ui|api}}", { area: "db" })).toThrow("area must be one of ui, api.");
  });

  it("turns a name into a slash command", () => {
    expect(templateCommand({ name: "Review PR" })).toBe("/review-pr");
    expect(templateCommand({ name: "  !!  " })).toBe("/prompt");
  });

  it("keeps well-formed entries and drops duplicates and junk", () => {
    expect(normalizePromptTemplates([
      { name: "Review", prompt: "Review {{file}}", description: "Look for bugs" },
      { name: "review", prompt: "dup" },
      { name: "", prompt: "nameless" },
      "junk",
      { name: "Plan", prompt: "Plan it" },
    ])).toEqual([
      { name: "Review", prompt: "Review {{file}}", description: "Look for bugs" },
      { name: "Plan", prompt: "Plan it" },
    ]);
    expect(normalizePromptTemplates("nope")).toEqual([]);
  });

  it("are read from capsule.json and from settings", () => {
    const state = parseProjectFile(JSON.stringify({ prompts: [{ name: "Triage", prompt: "Triage {{issue}}" }], actions: [{ name: "Check", command: "make check", check: true }] }));
    expect(state).toEqual({ status: "ok", file: { actions: [{ id: "file:check", name: "Check", command: "make check", check: true }], prompts: [{ name: "Triage", prompt: "Triage {{issue}}" }] } });
    expect(parseProjectFile(JSON.stringify({ prompts: {} }))).toEqual({ status: "invalid", error: "prompts must be a list." });
    expect(normalizeCapsuleSettings({ composerPrompts: [{ name: "Mine", prompt: "Do {{x}}" }] }).composerPrompts).toEqual([{ name: "Mine", prompt: "Do {{x}}" }]);
    expect(normalizeCapsuleSettings({ composerPrompts: [] }).composerPrompts).toBeUndefined();
  });
});
