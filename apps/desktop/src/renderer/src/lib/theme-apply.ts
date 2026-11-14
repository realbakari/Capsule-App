import {
  appearanceCssVars,
  backdropScrim,
  BUILTIN_TOKENS,
  contrastRatio,
  resolveThemeTokens,
  sceneSample,
  themeColorHex,
  type AppearancePalette,
  type BackdropView,
  type ThemeAppearance,
  type ThemeSummary,
} from "@capsule/shared";

/*
 * One ordering rule, lowest first: the stylesheet's tokens, then the
 * palette's derived variables, then the theme's own tokens with the person's
 * overrides. Capsule Light and Dark declare no tokens, so their palette shows
 * exactly as it always did. Any other theme lends its accent, base and text
 * to the palette, so the derived sidebar, hover and border colours follow
 * the theme, while fonts, contrast and translucency stay the palette's.
 */
export function themeVars(palette: AppearancePalette, theme: ThemeSummary | undefined): Record<string, string> {
  let source = palette;
  if (theme && !theme.builtin) {
    const resolved = resolveThemeTokens({ id: theme.id, name: theme.name, appearance: theme.appearance, tokens: theme.tokens }, theme.appearance);
    source = {
      ...palette,
      accent: themeColorHex(resolved.accent) ?? palette.accent,
      background: themeColorHex(resolved.base) ?? BUILTIN_TOKENS[theme.appearance].base,
      foreground: themeColorHex(resolved.text) ?? palette.foreground,
    };
  }
  const vars = appearanceCssVars(source);
  for (const [token, value] of Object.entries(theme?.tokens ?? {})) vars[`--${token}`] = value;
  if (theme?.tokens.base) vars["--bg"] = theme.tokens.base;
  return vars;
}

/** The colour the page and its text resolve to, as opaque hex, for the readability check. */
export function pageColours(vars: Readonly<Record<string, string>>, appearance: ThemeAppearance): { base: string; text: string } {
  return {
    base: themeColorHex(vars["--bg"] ?? "") ?? BUILTIN_TOKENS[appearance].base,
    text: themeColorHex(vars["--text"] ?? "") ?? BUILTIN_TOKENS[appearance].text,
  };
}

export interface BackdropPaint {
  /** `data-backdrop`: a scene name, `image`, or absent for none. */
  mode?: string;
  vars: Record<string, string>;
}

/**
 * Where a backdrop's variables come from. An image's worst colour is unknown
 * until it has been sampled, so until then the text colour stands in: the
 * worst case, veiled enough to read, rather than a flash of unreadable text.
 */
export function backdropPaint(view: BackdropView | undefined, page: { base: string; text: string }, options: { images: boolean; sample?: string }): BackdropPaint {
  const image = options.images ? view?.imageUrl : undefined;
  if (!view || (!view.scene && !image)) return { vars: {} };
  const sample = view.scene ? sceneSample(view.scene, page.base, page.text) : (options.sample ?? page.text);
  const veil = backdropScrim({ text: page.text, base: page.base, sample, opacity: view.opacity, dim: view.dim });
  const vars: Record<string, string> = {
    "--backdrop-opacity": String(view.opacity),
    "--backdrop-blur": `${view.blur}px`,
    "--backdrop-veil": String(veil),
  };
  if (!view.scene && image) {
    vars["--backdrop-image"] = `url("${image.replace(/["\\\n]/g, "")}")`;
    vars["--backdrop-size"] = view.fit === "tile" ? "auto" : view.fit;
    vars["--backdrop-repeat"] = view.fit === "tile" ? "repeat" : "no-repeat";
  }
  return { mode: view.scene ?? "image", vars };
}

/** The pixel of a small sample that comes closest to the text, from RGBA bytes. */
export function worstSample(pixels: ArrayLike<number>, text: string): string | undefined {
  let worst: string | undefined;
  let lowest = Infinity;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! < 16) continue;
    const hex = `#${[pixels[i]!, pixels[i + 1]!, pixels[i + 2]!].map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    const ratio = contrastRatio(hex, text);
    if (ratio < lowest) {
      lowest = ratio;
      worst = hex;
    }
  }
  return worst;
}
