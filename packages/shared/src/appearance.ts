export type AppearanceTheme = "system" | "dark" | "light";
export type AppearanceUiFont = "system" | "rounded" | "serif";
export type AppearanceCodeFont = "sf-mono" | "menlo" | "jetbrains";

export interface AppearancePalette {
  accent: string;
  background: string;
  foreground: string;
  contrast: number;
  translucentSidebar: boolean;
  uiFont: AppearanceUiFont;
  codeFont: AppearanceCodeFont;
}

export const DEFAULT_LIGHT_PALETTE: AppearancePalette = {
  accent: "#1A1A18",
  background: "#FFFFFF",
  foreground: "#1A1C1F",
  contrast: 45,
  translucentSidebar: true,
  uiFont: "system",
  codeFont: "sf-mono",
};

export const DEFAULT_DARK_PALETTE: AppearancePalette = {
  accent: "#F3F3EE",
  background: "#181818",
  foreground: "#FFFFFF",
  contrast: 45,
  translucentSidebar: true,
  uiFont: "system",
  codeFont: "sf-mono",
};

const UI_FONTS: AppearanceUiFont[] = ["system", "rounded", "serif"];
const CODE_FONTS: AppearanceCodeFont[] = ["sf-mono", "menlo", "jetbrains"];

export function normalizeHexColor(value: string | undefined, fallback: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(value?.trim() ?? "");
  return match?.[1] ? `#${match[1].toUpperCase()}` : fallback;
}

export function clampContrast(value: unknown, fallback = 45): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function normalizeAppearancePalette(
  input: Partial<AppearancePalette> | undefined,
  fallback: AppearancePalette,
): AppearancePalette {
  const raw = input ?? {};
  return {
    accent: normalizeHexColor(raw.accent, fallback.accent),
    background: normalizeHexColor(raw.background, fallback.background),
    foreground: normalizeHexColor(raw.foreground, fallback.foreground),
    contrast: clampContrast(raw.contrast, fallback.contrast),
    translucentSidebar: Boolean(raw.translucentSidebar ?? fallback.translucentSidebar),
    uiFont: pick(raw.uiFont, UI_FONTS, fallback.uiFont),
    codeFont: pick(raw.codeFont, CODE_FONTS, fallback.codeFont),
  };
}

export function parseRgb(hex: string): { r: number; g: number; b: number } | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return undefined;
  const n = Number.parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (channel: number) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

export function mixHex(a: string, b: string, amount: number): string {
  const left = parseRgb(a);
  const right = parseRgb(b);
  if (!left || !right) return a;
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    left.r + (right.r - left.r) * t,
    left.g + (right.g - left.g) * t,
    left.b + (right.b - left.b) * t,
  );
}

export function relativeLuminance(hex: string): number {
  const rgb = parseRgb(hex);
  if (!rgb) return 0;
  const lin = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

export function isDarkColor(hex: string): boolean {
  return relativeLuminance(hex) < 0.45;
}

export function inkOn(hex: string): string {
  return isDarkColor(hex) ? "#FFFFFF" : "#111111";
}

export const UI_FONT_STACKS: Record<AppearanceUiFont, string> = {
  system: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", system-ui, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, serif',
};

export const CODE_FONT_STACKS: Record<AppearanceCodeFont, string> = {
  "sf-mono": '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
  menlo: 'Menlo, Monaco, "SF Mono", ui-monospace, monospace',
  jetbrains: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace',
};

export function appearanceCssVars(palette: Partial<AppearancePalette> | undefined): Record<string, string> {
  const safePalette = normalizeAppearancePalette(palette, DEFAULT_DARK_PALETTE);
  const dark = isDarkColor(safePalette.background);
  const contrast = clampContrast(safePalette.contrast) / 100;
  const toward = dark ? "#000000" : "#D8D8D4";
  const lift = dark ? "#FFFFFF" : "#000000";
  const sidebarMix = 0.12 + contrast * 0.28;
  const elevatedMix = dark ? 0.05 + contrast * 0.08 : 0.02 + contrast * 0.04;
  const hoverAlpha = (dark ? 0.04 : 0.03) + contrast * (dark ? 0.08 : 0.06);
  const borderAlpha = 0.06 + contrast * 0.1;
  const hover = dark
    ? `rgb(255 255 255 / ${hoverAlpha.toFixed(3)})`
    : `rgb(0 0 0 / ${hoverAlpha.toFixed(3)})`;
  const border = dark
    ? `rgb(255 255 255 / ${borderAlpha.toFixed(3)})`
    : `rgb(0 0 0 / ${borderAlpha.toFixed(3)})`;
  const sidebar = mixHex(safePalette.background, toward, sidebarMix);
  const elevated = mixHex(safePalette.background, lift, elevatedMix);
  const glassOpacity = safePalette.translucentSidebar ? `${Math.round(62 + contrast * 20)}%` : "100%";
  return {
    "--bg": safePalette.background,
    "--base": safePalette.background,
    "--text": safePalette.foreground,
    "--accent": safePalette.accent,
    "--accent-fg": inkOn(safePalette.accent),
    "--ring": safePalette.accent,
    "--bg-sidebar": sidebar,
    "--mantle": sidebar,
    "--bg-elevated": elevated,
    "--surface-0": elevated,
    "--bg-hover": hover,
    "--bg-active": hover,
    "--border-color": border,
    "--glass-opacity": glassOpacity,
    "--sidebar-filter": safePalette.translucentSidebar ? "blur(18px) saturate(1.08)" : "none",
    "--sidebar-fill": safePalette.translucentSidebar
      ? `color-mix(in srgb, ${sidebar} ${glassOpacity}, transparent)`
      : sidebar,
    "--font": UI_FONT_STACKS[safePalette.uiFont] ?? UI_FONT_STACKS.system,
    "--mono": CODE_FONT_STACKS[safePalette.codeFont] ?? CODE_FONT_STACKS["sf-mono"],
  };
}
