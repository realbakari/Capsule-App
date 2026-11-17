import { isThemeColor, themeColorHex, type ThemeAppearance } from "./theme.js";
import { contrastRatio } from "./appearance.js";
import type { ThemeToken } from "./theme-tokens.js";

/*
 * The colour-theme format most code editors read: a `type`, a `colors` map
 * keyed by interface part ("editor.background"), and `tokenColors` rules that
 * colour syntax by scope name. Capsule reads one by mapping those parts to
 * its own tokens; anything a file leaves out keeps Capsule's value for that
 * appearance.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A Capsule theme names `tokens`; an editor theme names `colors` or `tokenColors`. */
export function isEditorTheme(json: unknown): json is Record<string, unknown> {
  return isRecord(json) && !("tokens" in json) && (isRecord(json.colors) || Array.isArray(json.tokenColors));
}

/** Interface parts to read for each token, best first. */
const FROM_COLORS: ReadonlyArray<readonly [ThemeToken, readonly string[]]> = [
  ["base", ["editor.background"]],
  ["mantle", ["sideBar.background", "editor.background"]],
  ["crust", ["activityBar.background", "titleBar.activeBackground", "sideBar.background"]],
  ["surface-0", ["editorWidget.background", "dropdown.background", "input.background"]],
  ["surface-1", ["editorGroupHeader.tabsBackground", "tab.inactiveBackground", "sideBar.background"]],
  ["surface-message", ["input.background", "editorWidget.background"]],
  ["text", ["editor.foreground", "foreground"]],
  ["subtext-1", ["foreground", "sideBar.foreground", "editor.foreground"]],
  ["subtext-0", ["descriptionForeground", "tab.inactiveForeground", "sideBar.foreground"]],
  ["overlay-1", ["editorLineNumber.activeForeground", "descriptionForeground"]],
  ["overlay-0", ["editorLineNumber.foreground", "descriptionForeground"]],
  ["accent", ["button.background", "focusBorder", "textLink.foreground"]],
  ["accent-fg", ["button.foreground"]],
  ["blue", ["terminal.ansiBlue", "textLink.foreground"]],
  ["green", ["terminal.ansiGreen", "gitDecoration.addedResourceForeground"]],
  ["yellow", ["terminal.ansiYellow", "editorWarning.foreground"]],
  ["red", ["terminal.ansiRed", "errorForeground", "editorError.foreground"]],
  ["code-bg", ["editor.background"]],
  ["reply-code-bg", ["editor.background"]],
  ["code-text", ["editor.foreground", "foreground"]],
  ["code-header", ["editorGroupHeader.tabsBackground", "tab.inactiveBackground"]],
  ["code-border", ["editorGroup.border", "panel.border", "editorWidget.border"]],
  ["code-muted", ["editorLineNumber.foreground", "descriptionForeground"]],
  ["diff-added-bg", ["diffEditor.insertedLineBackground", "diffEditor.insertedTextBackground"]],
  ["diff-removed-bg", ["diffEditor.removedLineBackground", "diffEditor.removedTextBackground"]],
  ["inline-code-bg", ["textCodeBlock.background"]],
  ["border-color", ["panel.border", "editorGroup.border", "sideBar.border"]],
  ["border-strong", ["contrastBorder", "editorWidget.border", "input.border"]],
  ["bg-hover", ["list.hoverBackground"]],
  ["bg-active", ["list.activeSelectionBackground", "list.inactiveSelectionBackground"]],
  ["sidebar-gradient-top", ["sideBar.background"]],
  ["sidebar-gradient-bottom", ["sideBar.background"]],
  ["sidebar-row-active-surface", ["list.activeSelectionBackground"]],
  ["sidebar-row-subtle-active-surface", ["list.inactiveSelectionBackground", "list.hoverBackground"]],
  ["markdown-note", ["terminal.ansiBlue", "textLink.foreground"]],
  ["markdown-tip", ["terminal.ansiGreen"]],
  ["markdown-important", ["terminal.ansiMagenta"]],
  ["markdown-warning", ["terminal.ansiYellow", "editorWarning.foreground"]],
  ["markdown-caution", ["terminal.ansiRed", "editorError.foreground"]],
  ...(["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const).flatMap((name) => {
    const title = name[0]!.toUpperCase() + name.slice(1);
    return [
      [`terminal-${name}`, [`terminal.ansi${title}`]] as const,
      [`terminal-bright-${name}`, [`terminal.ansiBright${title}`]] as const,
    ];
  }),
];

/** A scope that stands for each syntax token, most specific first, then the interface part to fall back on. */
const FROM_SCOPES: ReadonlyArray<readonly [ThemeToken, readonly string[], readonly string[]]> = [
  ["syntax-keyword", ["keyword.control", "keyword", "storage.type"], []],
  ["syntax-string", ["string.quoted", "string"], []],
  ["syntax-number", ["constant.numeric", "constant.language", "constant"], []],
  ["syntax-function", ["entity.name.function", "support.function"], []],
  ["syntax-type", ["entity.name.type", "support.type", "entity.name.class", "storage.type"], []],
  ["syntax-attribute", ["entity.other.attribute-name", "variable.other.property"], []],
  ["syntax-added", ["markup.inserted"], ["gitDecoration.addedResourceForeground", "terminal.ansiGreen"]],
  ["syntax-removed", ["markup.deleted"], ["gitDecoration.deletedResourceForeground", "terminal.ansiRed"]],
];

/** `#rgba` is valid in an editor theme but not in a stylesheet custom property Capsule checks; spell it out. */
function colour(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  const spelled = short ? `#${short.slice(1).map((c) => c + c).join("")}` : text;
  return isThemeColor(spelled) ? spelled : undefined;
}

/** Every simple selector a rule names, with the colour it gives. Descendant selectors ("source.js string") are skipped. */
function scopeRules(tokenColors: unknown): Array<{ selector: string; foreground: string }> {
  if (!Array.isArray(tokenColors)) return [];
  return tokenColors.flatMap((rule) => {
    if (!isRecord(rule) || !isRecord(rule.settings)) return [];
    const foreground = colour(rule.settings.foreground);
    if (!foreground) return [];
    const scopes = typeof rule.scope === "string" ? rule.scope.split(",") : Array.isArray(rule.scope) ? rule.scope.filter((s): s is string => typeof s === "string") : [];
    return scopes.map((scope) => scope.trim()).filter((scope) => scope && !/\s/.test(scope)).map((selector) => ({ selector, foreground }));
  });
}

/** The rule a scope-based highlighter would apply to `scope`: the longest selector that is a dotted prefix of it. */
function ruleFor(rules: ReadonlyArray<{ selector: string; foreground: string }>, scope: string): string | undefined {
  let best: { selector: string; foreground: string } | undefined;
  for (const rule of rules) {
    if (scope !== rule.selector && !scope.startsWith(`${rule.selector}.`)) continue;
    if (!best || rule.selector.length >= best.selector.length) best = rule;
  }
  return best?.foreground;
}

function appearanceOf(json: Record<string, unknown>, background: string | undefined): ThemeAppearance {
  const type = typeof json.type === "string" ? json.type.toLowerCase() : "";
  if (type === "light" || type === "hc-light") return "light";
  if (type === "dark" || type === "hc-black" || type === "hc-dark") return "dark";
  const hex = background ? themeColorHex(background) : undefined;
  if (!hex) return "dark";
  return contrastRatio(hex, "#000000") > contrastRatio(hex, "#ffffff") ? "light" : "dark";
}

function nameFrom(fileName: string): string {
  const stem = fileName.replace(/\.jsonc?$/i, "").replace(/[-_.]?colou?r[-_]?theme$/i, "");
  const words = stem.replace(/[-_.]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Imported theme";
}

/**
 * An editor colour theme as a Capsule theme file's contents. The result is
 * checked like any theme file; this only decides which colour goes where.
 */
export function editorThemeToCapsule(json: Record<string, unknown>, fileName: string): { name: string; appearance: ThemeAppearance; tokens: Partial<Record<ThemeToken, string>> } {
  const colors = isRecord(json.colors) ? json.colors : {};
  const tokens: Partial<Record<ThemeToken, string>> = {};
  for (const [token, keys] of FROM_COLORS) {
    for (const key of keys) {
      const value = colour(colors[key]);
      if (value) { tokens[token] = value; break; }
    }
  }
  const rules = scopeRules(json.tokenColors);
  // A file's first rule with no scope is its default foreground, which code text follows.
  const plain = Array.isArray(json.tokenColors)
    ? json.tokenColors.find((rule) => isRecord(rule) && rule.scope === undefined && isRecord(rule.settings))
    : undefined;
  const plainForeground = isRecord(plain) && isRecord(plain.settings) ? colour(plain.settings.foreground) : undefined;
  if (plainForeground && !tokens["code-text"]) tokens["code-text"] = plainForeground;
  for (const [token, scopes, fallbacks] of FROM_SCOPES) {
    const value = scopes.map((scope) => ruleFor(rules, scope)).find(Boolean) ?? fallbacks.map((key) => colour(colors[key])).find(Boolean);
    if (value) tokens[token] = value;
  }
  const name = typeof json.name === "string" && json.name.trim() ? json.name.trim().slice(0, 80) : nameFrom(fileName);
  return { name, appearance: appearanceOf(json, tokens.base), tokens };
}
