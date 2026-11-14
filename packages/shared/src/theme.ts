import { contrastRatio, rgbToHex } from "./appearance.js";
import { backdropHasImage, parseBackdrop, stripBackdropImages, type ThemeBackdrop } from "./backdrop.js";
import { BUILTIN_TOKENS, THEME_TOKENS, type ThemeToken } from "./theme-tokens.js";

export type ThemeAppearance = "light" | "dark";

/** A theme file, parsed. Tokens it leaves out come from the built-in theme for its appearance. */
export interface Theme {
  id: string;
  name: string;
  appearance: ThemeAppearance;
  tokens: Partial<Record<ThemeToken, string>>;
  /** What the conversation column draws behind it. Settings may override it. */
  backdrop?: ThemeBackdrop;
}

export interface ThemeProblem {
  /** `error` for an entry that was skipped, `warning` for one that was ignored as unknown. */
  severity: "error" | "warning";
  key?: string;
  message: string;
}

const TOKEN_SET = new Set<string>(THEME_TOKENS);

export function isThemeToken(name: string): name is ThemeToken {
  return TOKEN_SET.has(name);
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

function component(text: string, units: readonly string[]): { value: number; unit: string } | undefined {
  const match = NUMBER.exec(text);
  if (!match) return undefined;
  const unit = text.slice(match[0].length).toLowerCase();
  if (!units.includes(unit)) return undefined;
  return { value: Number(match[0]), unit };
}

function alphaOf(text: string | undefined): number | undefined {
  if (text === undefined) return 1;
  const a = component(text, ["", "%"]);
  if (!a) return undefined;
  const value = a.unit === "%" ? a.value / 100 : a.value;
  return value >= 0 && value <= 1 ? value : undefined;
}

function hue(text: string): number | undefined {
  const h = component(text, ["", "deg", "turn", "rad"]);
  if (!h) return undefined;
  const deg = h.unit === "turn" ? h.value * 360 : h.unit === "rad" ? (h.value * 180) / Math.PI : h.value;
  return ((deg % 360) + 360) % 360;
}

function encodeGamma(linear: number): number {
  const c = Math.max(0, Math.min(1, linear));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
}

/**
 * The colour forms a theme may use: hex (3, 6 or 8 digits), rgb(), hsl() and
 * oklch(). Anything else, including `var()`, named colours and out-of-range
 * channels, is refused so a theme can only ever set a colour.
 */
function parseColour(text: string): Rgba | undefined {
  const value = text.trim().toLowerCase();
  if (value.length > 64) return undefined;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?|oklch)\(([^()]*)\)$/.exec(value);
  if (!fn) return undefined;
  const [channels, alphaText, extra] = fn[2]!.split("/").map((s) => s.trim());
  if (extra !== undefined) return undefined;
  let parts = channels!.includes(",") ? channels!.split(",").map((s) => s.trim()) : channels!.split(/\s+/);
  let alphaPart = alphaText;
  if (channels!.includes(",") && parts.length === 4 && alphaPart === undefined) {
    alphaPart = parts[3];
    parts = parts.slice(0, 3);
  }
  if (parts.length !== 3 || parts.some((p) => !p)) return undefined;
  const a = alphaOf(alphaPart);
  if (a === undefined) return undefined;

  if (fn[1]!.startsWith("rgb")) {
    const channel = parts.map((p) => {
      const c = component(p, ["", "%"]);
      if (!c) return undefined;
      const v = c.unit === "%" ? (c.value / 100) * 255 : c.value;
      return v >= 0 && v <= 255 ? v : undefined;
    });
    if (channel.some((c) => c === undefined)) return undefined;
    const [r, g, b] = channel as [number, number, number];
    return { r, g, b, a };
  }

  if (fn[1]!.startsWith("hsl")) {
    const h = hue(parts[0]!);
    const s = component(parts[1]!, ["%"]);
    const l = component(parts[2]!, ["%"]);
    if (h === undefined || !s || !l || s.value < 0 || s.value > 100 || l.value < 0 || l.value > 100) return undefined;
    const sat = s.value / 100;
    const light = l.value / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return 255 * (light - sat * Math.min(light, 1 - light) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return { r: f(0), g: f(8), b: f(4), a };
  }

  const lPart = component(parts[0]!, ["", "%"]);
  const cPart = component(parts[1]!, ["", "%"]);
  const h = hue(parts[2]!);
  if (!lPart || !cPart || h === undefined) return undefined;
  const L = lPart.unit === "%" ? lPart.value / 100 : lPart.value;
  const C = cPart.unit === "%" ? (cPart.value / 100) * 0.4 : cPart.value;
  if (L < 0 || L > 1 || C < 0 || C > 0.5) return undefined;
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: encodeGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encodeGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encodeGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a,
  };
}

export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && parseColour(value) !== undefined;
}

/** `#RRGGBB` for an opaque colour, for contrast checks. Translucent colours have no fixed contrast. */
export function themeColorHex(value: string): string | undefined {
  const rgba = parseColour(value);
  return rgba && rgba.a === 1 ? rgbToHex(rgba.r, rgba.g, rgba.b) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const THEME_KEYS = new Set(["$schema", "name", "appearance", "tokens", "syntax", "backdrop"]);

export function parseTheme(json: unknown, id: string): { theme?: Theme; problems: ThemeProblem[] } {
  const problems: ThemeProblem[] = [];
  if (!isRecord(json)) return { problems: [{ severity: "error", message: "A theme file must be a JSON object." }] };
  const name = typeof json.name === "string" ? json.name.trim() : "";
  if (!name || name.length > 80) problems.push({ severity: "error", key: "name", message: "name must be text of 1 to 80 characters." });
  const appearance = json.appearance;
  if (appearance !== "light" && appearance !== "dark") {
    problems.push({ severity: "error", key: "appearance", message: 'appearance must be "light" or "dark".' });
  }
  if (problems.length > 0) return { problems };

  for (const key of Object.keys(json)) {
    if (!THEME_KEYS.has(key)) problems.push({ severity: "warning", key, message: `Unknown key "${key}" is ignored.` });
  }

  const tokens: Partial<Record<ThemeToken, string>> = {};
  const take = (section: string, entries: unknown, toToken: (key: string) => string) => {
    if (entries === undefined) return;
    if (!isRecord(entries)) {
      problems.push({ severity: "error", key: section, message: `${section} must be an object of colours.` });
      return;
    }
    for (const [key, value] of Object.entries(entries)) {
      const token = toToken(key);
      const where = `${section}.${key}`;
      if (!isThemeToken(token)) {
        problems.push({ severity: "warning", key: where, message: `"${key}" is not a theme token and is ignored.` });
      } else if (!isThemeColor(value)) {
        problems.push({
          severity: "error",
          key: where,
          message: `${JSON.stringify(value)} is not a colour. Use hex, rgb(), hsl() or oklch().`,
        });
      } else {
        tokens[token] = value.trim();
      }
    }
  };
  take("syntax", json.syntax, (key) => `syntax-${key}`);
  take("tokens", json.tokens, (key) => key.replace(/^--/, ""));
  const backdrop = parseBackdrop(json.backdrop);
  problems.push(...backdrop.problems);

  return {
    theme: { id, name, appearance: appearance as ThemeAppearance, tokens, ...(backdrop.backdrop ? { backdrop: backdrop.backdrop } : {}) },
    problems,
  };
}

/**
 * The built-in tokens for the theme's own appearance (or `appearance` when
 * there is no theme), then the theme's, then the user's overrides. Overrides
 * that are not a known token and a colour are dropped; the settings validator
 * reports them.
 */
export function resolveThemeTokens(
  theme: Theme | undefined,
  appearance: ThemeAppearance,
  overrides?: Readonly<Record<string, string>>,
): Record<ThemeToken, string> {
  const resolved: Record<ThemeToken, string> = { ...BUILTIN_TOKENS[theme?.appearance ?? appearance], ...theme?.tokens };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const token = key.replace(/^--/, "");
    if (isThemeToken(token) && isThemeColor(value)) resolved[token] = value.trim();
  }
  return resolved;
}

export const MIN_TEXT_CONTRAST = 4.5;

/** Text and background pairs that must stay readable. Each passes in both built-in themes. */
const CONTRAST_PAIRS: ReadonlyArray<readonly [ThemeToken, ThemeToken]> = [
  ...(["base", "mantle", "surface-0", "surface-1", "surface-message"] as const).map((bg) => ["text", bg] as const),
  ...(["base", "surface-0", "surface-1"] as const).map((bg) => ["subtext-0", bg] as const),
  ["subtext-1", "base"],
  ["accent-fg", "accent"],
  ["red", "base"],
  ["green", "base"],
  ["code-text", "code-bg"],
  ["code-text", "diff-added-bg"],
  ["code-text", "diff-removed-bg"],
  ["code-muted", "code-bg"],
  ...THEME_TOKENS.filter((t) => t.startsWith("syntax-")).map((t) => [t, "code-bg"] as const),
  ...THEME_TOKENS.filter((t) => t.startsWith("markdown-")).map((t) => [t, "base"] as const),
];

export interface ContrastWarning {
  foreground: ThemeToken;
  background: ThemeToken;
  ratio: number;
  message: string;
}

export function themeContrastWarnings(tokens: Readonly<Record<ThemeToken, string>>): ContrastWarning[] {
  const warnings: ContrastWarning[] = [];
  for (const [foreground, background] of CONTRAST_PAIRS) {
    const fg = themeColorHex(tokens[foreground]);
    const bg = themeColorHex(tokens[background]);
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio < MIN_TEXT_CONTRAST) {
      warnings.push({
        foreground,
        background,
        ratio,
        message: `${foreground} on ${background} has a contrast of ${ratio.toFixed(2)}:1, under ${MIN_TEXT_CONTRAST}:1.`,
      });
    }
  }
  return warnings;
}

/* ── Share strings ── */

export const THEME_SHARE_PREFIX = "capsule-theme:";
export const MAX_THEME_SHARE_BYTES = 32 * 1024;

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += BASE64URL[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array | undefined {
  if (text.length % 4 === 1) return undefined;
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const v = j < chunk.length ? BASE64URL.indexOf(chunk[j]!) : 0;
      if (v === -1) return undefined;
      n = (n << 6) | v;
    }
    const count = chunk.length - 1;
    for (let j = 0; j < count; j++) bytes.push((n >> (16 - 8 * j)) & 255);
  }
  return Uint8Array.from(bytes);
}

/** A backdrop travels as its scene and numbers. An image path never leaves the machine. */
export function encodeThemeShareString(theme: Theme): string {
  const backdrop = stripBackdropImages(theme.backdrop);
  const json = JSON.stringify({ name: theme.name, appearance: theme.appearance, tokens: theme.tokens, ...(backdrop ? { backdrop } : {}) });
  return THEME_SHARE_PREFIX + toBase64Url(new TextEncoder().encode(json));
}

export type DecodedThemeShare = { ok: true; theme: Theme; problems: ThemeProblem[] } | { ok: false; message: string };

/** The theme's id comes from its name, since a share string carries no file name. */
export function decodeThemeShareString(text: string): DecodedThemeShare {
  const trimmed = text.trim();
  if (!trimmed.startsWith(THEME_SHARE_PREFIX)) return { ok: false, message: `A shared theme starts with ${THEME_SHARE_PREFIX}` };
  if (trimmed.length > MAX_THEME_SHARE_BYTES) return { ok: false, message: "This shared theme is larger than 32 KB." };
  const bytes = fromBase64Url(trimmed.slice(THEME_SHARE_PREFIX.length));
  if (!bytes) return { ok: false, message: "This shared theme is damaged: it is not valid base64url." };
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, message: "This shared theme is damaged: it does not hold valid JSON." };
  }
  if (isRecord(json) && isRecord(json.backdrop) && backdropHasImage(json.backdrop as ThemeBackdrop)) {
    return { ok: false, message: "This shared theme names an image file. A shared theme can carry a scene, never a file." };
  }
  const name = isRecord(json) && typeof json.name === "string" ? json.name : "";
  const id =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "shared-theme";
  const { theme, problems } = parseTheme(json, id);
  if (!theme) return { ok: false, message: problems[0]?.message ?? "This shared theme could not be read." };
  return { ok: true, theme, problems };
}

/* ── Bundled themes ── */

export const BUNDLED_THEMES: readonly Theme[] = [
  { id: "capsule-light", name: "Capsule Light", appearance: "light", tokens: {} },
  { id: "capsule-dark", name: "Capsule Dark", appearance: "dark", tokens: {} },
  {
    id: "paper",
    name: "Paper",
    appearance: "light",
    tokens: {
      crust: "#e6dfd1",
      mantle: "#ede6d8",
      base: "#f6f1e7",
      "surface-0": "#fffaf0",
      "surface-1": "#efe8da",
      "overlay-0": "#6f6656",
      "overlay-1": "#857b6a",
      "subtext-0": "#5e5546",
      "subtext-1": "#3d3529",
      text: "#231d14",
      accent: "#7a3e1d",
      "accent-fg": "#fffaf0",
      blue: "#3c5a73",
      green: "#4a6630",
      yellow: "#7a5c0e",
      red: "#9c3a2a",
      "code-bg": "#f1ebde",
      "code-text": "#2a2318",
      "code-header": "#e9e1d1",
      "code-border": "#d6ccb8",
      "code-muted": "#685e4d",
      "diff-added-bg": "#e6efd9",
      "diff-removed-bg": "#f6e1d8",
      "syntax-keyword": "#8a3b12",
      "syntax-string": "#4f6a22",
      "syntax-number": "#7a5410",
      "syntax-function": "#2f5f66",
      "syntax-type": "#3f5878",
      "syntax-attribute": "#6e5426",
      "syntax-added": "#3f6a2c",
      "syntax-removed": "#a23a2a",
      "markdown-note": "#3f5878",
      "markdown-tip": "#4f6a22",
      "markdown-important": "#2f5f66",
      "markdown-warning": "#7a5410",
      "markdown-caution": "#a23a2a",
      "surface-message": "#ebe3d3",
      "sidebar-gradient-top": "#efe8da",
      "sidebar-gradient-bottom": "#e6dfd1",
    },
  },
  {
    id: "meadow",
    name: "Meadow",
    appearance: "light",
    tokens: {
      crust: "#dde5e0",
      mantle: "#e3eae5",
      base: "#eff4f0",
      "surface-0": "#fbfdfb",
      "surface-1": "#e7eee9",
      "overlay-0": "#5d6b63",
      "overlay-1": "#74827a",
      "subtext-0": "#4f5d55",
      "subtext-1": "#34413a",
      text: "#15201a",
      accent: "#2f6b4f",
      "accent-fg": "#f7fbf8",
      blue: "#2f5d7a",
      green: "#2f6b3a",
      yellow: "#6f5a10",
      red: "#9a3b3b",
      "code-bg": "#eaf1ec",
      "code-text": "#1d2a23",
      "code-header": "#e1e9e3",
      "code-border": "#c9d5cd",
      "code-muted": "#55645b",
      "diff-added-bg": "#dcecdf",
      "diff-removed-bg": "#f3e0de",
      "syntax-keyword": "#2b5f8a",
      "syntax-string": "#3d6a2a",
      "syntax-number": "#7a4f12",
      "syntax-function": "#1f6660",
      "syntax-type": "#4a557f",
      "syntax-attribute": "#6a5a2a",
      "syntax-added": "#2f6a35",
      "syntax-removed": "#9a3a3a",
      "markdown-note": "#2b5f8a",
      "markdown-tip": "#3d6a2a",
      "markdown-important": "#1f6660",
      "markdown-warning": "#7a4f12",
      "markdown-caution": "#9a3a3a",
      "surface-message": "#e0e8e2",
      "sidebar-gradient-top": "#e7eee9",
      "sidebar-gradient-bottom": "#dde5e0",
    },
  },
  {
    id: "harbor",
    name: "Harbor",
    appearance: "dark",
    tokens: {
      crust: "#070b10",
      mantle: "#0c121a",
      base: "#0e151e",
      "surface-0": "#141c26",
      "surface-1": "#1b2531",
      "overlay-0": "#4f5d6e",
      "overlay-1": "#75849a",
      "subtext-0": "#95a3b5",
      "subtext-1": "#bcc7d4",
      text: "#e6edf5",
      accent: "#7fb4e6",
      "accent-fg": "#0b1420",
      blue: "#8db8e8",
      green: "#8cc7a1",
      yellow: "#e0c27a",
      red: "#ec9a9a",
      "code-bg": "#111a24",
      "code-text": "#dfe7f0",
      "code-header": "#16202c",
      "code-border": "#2a3646",
      "code-muted": "#98a6b8",
      "diff-added-bg": "#15271f",
      "diff-removed-bg": "#2b1a1f",
      "syntax-keyword": "#8fb7f0",
      "syntax-string": "#a6d4a0",
      "syntax-number": "#e7c58f",
      "syntax-function": "#7fd0d6",
      "syntax-type": "#b3c6f2",
      "syntax-attribute": "#d6bf96",
      "syntax-added": "#9fd09a",
      "syntax-removed": "#f0a3a3",
      "markdown-note": "#8fb7f0",
      "markdown-tip": "#a6d4a0",
      "markdown-important": "#7fd0d6",
      "markdown-warning": "#e7c58f",
      "markdown-caution": "#f0a3a3",
      "surface-message": "#19222e",
      "sidebar-gradient-top": "#0f1720",
      "sidebar-gradient-bottom": "#0a1017",
    },
  },
  {
    id: "ember",
    name: "Ember",
    appearance: "dark",
    tokens: {
      crust: "#0d0907",
      mantle: "#14100c",
      base: "#17120e",
      "surface-0": "#1e1813",
      "surface-1": "#272019",
      "overlay-0": "#5e5246",
      "overlay-1": "#8a7c6c",
      "subtext-0": "#a89a88",
      "subtext-1": "#cdbfad",
      text: "#f2e8dc",
      accent: "#e8a35c",
      "accent-fg": "#1b120a",
      blue: "#9fb8d0",
      green: "#b3c98a",
      yellow: "#e8c46a",
      red: "#ef9580",
      "code-bg": "#1c1611",
      "code-text": "#eee3d4",
      "code-header": "#231c16",
      "code-border": "#3a3027",
      "code-muted": "#ab9d8b",
      "diff-added-bg": "#1e2717",
      "diff-removed-bg": "#2f1c17",
      "syntax-keyword": "#f0a46a",
      "syntax-string": "#bcd08f",
      "syntax-number": "#e9c77e",
      "syntax-function": "#8fc8c0",
      "syntax-type": "#a9c3dd",
      "syntax-attribute": "#dcc08e",
      "syntax-added": "#b0d08f",
      "syntax-removed": "#f2a090",
      "markdown-note": "#a9c3dd",
      "markdown-tip": "#bcd08f",
      "markdown-important": "#8fc8c0",
      "markdown-warning": "#e9c77e",
      "markdown-caution": "#f2a090",
      "surface-message": "#221b15",
      "sidebar-gradient-top": "#19130f",
      "sidebar-gradient-bottom": "#110d0a",
    },
  },
];
