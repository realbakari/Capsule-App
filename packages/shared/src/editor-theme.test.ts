import { describe, expect, it } from "vitest";
import { editorThemeToCapsule, isEditorTheme } from "./editor-theme.js";
import { parseTheme } from "./theme.js";

const dusk = {
  name: "Dusk",
  type: "dark",
  colors: {
    "editor.background": "#1e1e2e",
    "editor.foreground": "#cdd6f4",
    "sideBar.background": "#181825",
    "activityBar.background": "#11111b",
    "button.background": "#89b4fa",
    "button.foreground": "#11111b",
    "list.hoverBackground": "#cdd6f41a",
    "diffEditor.insertedLineBackground": "#a6e3a133",
    "terminal.ansiRed": "#f38ba8",
    "terminal.ansiBrightBlue": "#89b4fa",
    "editorWidget.border": "#45f",
    "panel.border": "#313244",
    "not.a.colour": "rebeccapurple-ish",
  },
  tokenColors: [
    { settings: { foreground: "#cdd6f4" } },
    { scope: "keyword", settings: { foreground: "#cba6f7" } },
    { scope: ["keyword.operator"], settings: { foreground: "#89dceb" } },
    { scope: "string, string.quoted", settings: { foreground: "#a6e3a1" } },
    { scope: "constant.numeric", settings: { foreground: "#fab387", fontStyle: "italic" } },
    { scope: "entity.name.function", settings: { foreground: "#89b4fa" } },
    { scope: "source.js entity.name.type", settings: { foreground: "#000000" } },
    { scope: "support.type", settings: { foreground: "#f9e2af" } },
    { scope: "markup.deleted", settings: { foreground: "#f38ba8" } },
  ],
};

describe("editor colour themes", () => {
  it("tells an editor theme from a Capsule theme", () => {
    expect(isEditorTheme(dusk)).toBe(true);
    expect(isEditorTheme({ name: "Mine", appearance: "dark", tokens: { base: "#000000" } })).toBe(false);
    expect(isEditorTheme({ name: "Bare" })).toBe(false);
  });

  it("maps interface colours to the surfaces that play the same part", () => {
    const theme = editorThemeToCapsule(dusk, "dusk-color-theme.json");
    expect(theme).toMatchObject({ name: "Dusk", appearance: "dark" });
    expect(theme.tokens).toMatchObject({
      base: "#1e1e2e",
      mantle: "#181825",
      crust: "#11111b",
      text: "#cdd6f4",
      accent: "#89b4fa",
      "accent-fg": "#11111b",
      "bg-hover": "#cdd6f41a",
      "diff-added-bg": "#a6e3a133",
      red: "#f38ba8",
      "terminal-bright-blue": "#89b4fa",
      "border-color": "#313244",
    });
  });

  it("spells out short #rgba colours and drops values that are not colours", () => {
    const theme = editorThemeToCapsule({ colors: { "editorWidget.border": "#45f8", "editor.background": "nope" } }, "x.json");
    expect(theme.tokens["border-strong"]).toBe("#4455ff88");
    expect(theme.tokens.base).toBeUndefined();
  });

  it("colours syntax the way the editor would, by the most specific matching scope", () => {
    const { tokens } = editorThemeToCapsule(dusk, "dusk.json");
    expect(tokens["syntax-keyword"]).toBe("#cba6f7");
    expect(tokens["syntax-string"]).toBe("#a6e3a1");
    expect(tokens["syntax-number"]).toBe("#fab387");
    expect(tokens["syntax-function"]).toBe("#89b4fa");
    // A descendant selector applies only inside one language, so it does not speak for every type.
    expect(tokens["syntax-type"]).toBe("#f9e2af");
    expect(tokens["syntax-removed"]).toBe("#f38ba8");
    expect(tokens["code-text"]).toBe("#cdd6f4");
  });

  it("reads the appearance from the type, or from the background when there is none", () => {
    expect(editorThemeToCapsule({ type: "hc-light", colors: {} }, "a.json").appearance).toBe("light");
    expect(editorThemeToCapsule({ colors: { "editor.background": "#fdf6e3" } }, "a.json").appearance).toBe("light");
    expect(editorThemeToCapsule({ colors: { "editor.background": "#002b36" } }, "a.json").appearance).toBe("dark");
  });

  it("names an unnamed theme after its file", () => {
    expect(editorThemeToCapsule({ colors: {} }, "solar-flare-color-theme.json").name).toBe("Solar flare");
  });

  it("produces a theme file Capsule accepts without complaint", () => {
    const parsed = parseTheme(editorThemeToCapsule(dusk, "dusk.json"), "dusk");
    expect(parsed.theme?.appearance).toBe("dark");
    expect(parsed.problems).toEqual([]);
  });
});
