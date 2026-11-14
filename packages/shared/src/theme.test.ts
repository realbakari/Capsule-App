import { describe, expect, it } from "vitest";

import {
  BUNDLED_THEMES,
  decodeThemeShareString,
  encodeThemeShareString,
  isThemeColor,
  parseTheme,
  resolveThemeTokens,
  THEME_SHARE_PREFIX,
  themeContrastWarnings,
  type Theme,
} from "./theme.js";
import { BUILTIN_TOKENS, THEME_TOKENS } from "./theme-tokens.js";

describe("isThemeColor", () => {
  it.each(["#abc", "#A1B2C3", "#a1b2c3cc", "rgb(10 20 30)", "rgb(10, 20, 30)", "rgba(10, 20, 30, 0.5)", "rgb(0 0 0 / 5%)", "rgb(100% 0% 0%)", "hsl(210 40% 50%)", "hsl(210deg, 40%, 50%)", "oklch(0.7 0.1 250)", "oklch(70% 0.1 250 / 0.8)"])(
    "accepts %s",
    (value) => expect(isThemeColor(value)).toBe(true),
  );

  it.each(["red", "#abcd", "#ggg", "rgb(300 0 0)", "rgb(1 2)", "hsl(10 120% 50%)", "oklch(2 0.1 10)", "var(--text)", "rgb(1 2 3); background: url(x)", "", 12, null])(
    "refuses %s",
    (value) => expect(isThemeColor(value)).toBe(false),
  );
});

describe("parseTheme", () => {
  it("reads tokens and the syntax shorthand", () => {
    const { theme, problems } = parseTheme(
      {
        $schema: "https://example.com/theme.schema.json",
        name: " Dusk ",
        appearance: "dark",
        tokens: { text: "#fafafa", "--base": "#101010" },
        syntax: { keyword: "#88aaff" },
      },
      "dusk",
    );
    expect(problems).toEqual([]);
    expect(theme).toEqual({
      id: "dusk",
      name: "Dusk",
      appearance: "dark",
      tokens: { text: "#fafafa", base: "#101010", "syntax-keyword": "#88aaff" },
    });
  });

  it("warns about unknown tokens, skips bad colours and keeps the rest", () => {
    const { theme, problems } = parseTheme(
      { name: "X", appearance: "light", colours: {}, tokens: { text: "#111", sparkle: "#fff", base: "chartreuse" }, syntax: { glitter: "#000" } },
      "x",
    );
    expect(theme?.tokens).toEqual({ text: "#111" });
    expect(problems.map((p) => [p.severity, p.key])).toEqual([
      ["warning", "colours"],
      ["warning", "syntax.glitter"],
      ["warning", "tokens.sparkle"],
      ["error", "tokens.base"],
    ]);
  });

  it("refuses a file without a name or appearance", () => {
    expect(parseTheme({ appearance: "dark" }, "a").theme).toBeUndefined();
    expect(parseTheme({ name: "A", appearance: "dim" }, "a").theme).toBeUndefined();
    expect(parseTheme([], "a").theme).toBeUndefined();
  });
});

describe("resolveThemeTokens", () => {
  const dusk: Theme = { id: "dusk", name: "Dusk", appearance: "dark", tokens: { text: "#fafafa" } };

  it("layers built-in, theme and overrides", () => {
    const tokens = resolveThemeTokens(dusk, "dark", { base: "#000000", "--accent": "#ff8800", nonsense: "#fff", red: "url(x)" });
    expect(tokens.text).toBe("#fafafa");
    expect(tokens.base).toBe("#000000");
    expect(tokens.accent).toBe("#ff8800");
    expect(tokens.red).toBe(BUILTIN_TOKENS.dark.red);
    expect(tokens.green).toBe(BUILTIN_TOKENS.dark.green);
    expect(Object.keys(tokens).sort()).toEqual([...THEME_TOKENS].sort());
  });

  it("fills a theme's gaps from its own appearance", () => {
    expect(resolveThemeTokens(dusk, "light").base).toBe(BUILTIN_TOKENS.dark.base);
    expect(resolveThemeTokens(undefined, "light")).toEqual(BUILTIN_TOKENS.light);
  });
});

describe("themeContrastWarnings", () => {
  it("flags text that is hard to read on its background", () => {
    const tokens = resolveThemeTokens(undefined, "light", { text: "#aaaaaa" });
    const warnings = themeContrastWarnings(tokens);
    expect(warnings.map((w) => [w.foreground, w.background])).toContainEqual(["text", "base"]);
    expect(warnings.every((w) => w.ratio < 4.5)).toBe(true);
  });

  it("checks colours written as hsl and oklch", () => {
    const tokens = resolveThemeTokens(undefined, "dark", { "code-text": "hsl(0 0% 15%)", text: "oklch(0.25 0 0)" });
    const pairs = themeContrastWarnings(tokens).map((w) => `${w.foreground}/${w.background}`);
    expect(pairs).toContain("code-text/code-bg");
    expect(pairs).toContain("text/base");
  });
});

describe("bundled themes", () => {
  it("are the two built-ins and four originals, two of each appearance", () => {
    expect(BUNDLED_THEMES.map((t) => t.id)).toEqual(["capsule-light", "capsule-dark", "paper", "meadow", "harbor", "ember"]);
    expect(BUNDLED_THEMES.filter((t) => t.appearance === "light")).toHaveLength(3);
  });

  it.each(BUNDLED_THEMES.map((t) => [t.id, t] as const))("%s reads at 4.5:1 and uses only valid tokens", (_id, theme) => {
    const reparsed = parseTheme({ name: theme.name, appearance: theme.appearance, tokens: theme.tokens }, theme.id);
    expect(reparsed.problems).toEqual([]);
    expect(themeContrastWarnings(resolveThemeTokens(theme, theme.appearance))).toEqual([]);
  });
});

describe("share strings", () => {
  const harbor = BUNDLED_THEMES.find((t) => t.id === "harbor")!;

  it("round-trips a theme", () => {
    const text = encodeThemeShareString(harbor);
    expect(text.startsWith(THEME_SHARE_PREFIX)).toBe(true);
    expect(text.slice(THEME_SHARE_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeThemeShareString(`  ${text}\n`)).toEqual({ ok: true, theme: harbor, problems: [] });
  });

  it("round-trips names outside ASCII", () => {
    const theme: Theme = { id: "x", name: "Crème brûlée ☕", appearance: "light", tokens: { text: "#111111" } };
    const decoded = decodeThemeShareString(encodeThemeShareString(theme));
    expect(decoded).toMatchObject({ ok: true, theme: { name: "Crème brûlée ☕", id: "cr-me-br-l-e" } });
  });

  it("refuses strings that are not a theme", () => {
    expect(decodeThemeShareString("hello").ok).toBe(false);
    expect(decodeThemeShareString(`${THEME_SHARE_PREFIX}***`).ok).toBe(false);
    expect(decodeThemeShareString(`${THEME_SHARE_PREFIX}aGVsbG8`).ok).toBe(false);
    expect(decodeThemeShareString(`${THEME_SHARE_PREFIX}${"A".repeat(33 * 1024)}`)).toMatchObject({ ok: false, message: expect.stringMatching(/32 KB/) });
  });
});

describe("share strings and backdrops", () => {
  const base: Theme = { id: "dusk", name: "Dusk", appearance: "dark", tokens: {} };

  it("carry a scene and its numbers but never an image path", () => {
    const theme: Theme = { ...base, backdrop: { scene: "mesh", dim: 0.3, light: { image: "/Users/me/secret.png", opacity: 0.5 } } };
    const decoded = decodeThemeShareString(encodeThemeShareString(theme));
    expect(decoded).toMatchObject({ ok: true, theme: { backdrop: { scene: "mesh", dim: 0.3, light: { opacity: 0.5 } } } });
    expect(JSON.stringify(decoded)).not.toContain("secret.png");
  });

  it("refuses a hand-made string that names an image", () => {
    const json = JSON.stringify({ name: "Dusk", appearance: "dark", backdrop: { dark: { image: "../../etc/x.png" } } });
    const text = THEME_SHARE_PREFIX + Buffer.from(json).toString("base64url");
    expect(decodeThemeShareString(text)).toMatchObject({ ok: false, message: expect.stringMatching(/image/) });
  });

  it("parses a theme file's backdrop and reports a wrong field without dropping the theme", () => {
    const { theme, problems } = parseTheme({ name: "Dusk", appearance: "dark", backdrop: { scene: "dots", opacity: 3, image: "https://x/y.png" } }, "dusk");
    expect(theme?.backdrop).toEqual({ scene: "dots" });
    expect(problems.map((p) => p.key)).toEqual(["backdrop.image", "backdrop.opacity"]);
  });
});
