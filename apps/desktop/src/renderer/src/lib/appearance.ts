import {
  CODE_FONT_STACKS,
  mergeBackdrop,
  sanitizeFontName,
  TRANSCRIPT_SIZE_CSS,
  TRANSCRIPT_WIDTH_CSS,
  type AppearanceTheme,
  type BackdropScene,
  type BackdropView,
  type CapsuleSettings,
  type ThemeAppearance,
  type ThemeState,
} from "@capsule/shared";
import { backdropPaint, pageColours, themeVars, worstSample } from "./theme-apply";

function resolvedTheme(theme: AppearanceTheme): "dark" | "light" {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

let lastSettings: CapsuleSettings | undefined;
let lastThemes: ThemeState | undefined;
let media: MediaQueryList | undefined;
/** A theme shown while the pointer or focus rests on it in Settings; never remembered. */
let previewTheme: string | undefined;
/** A scene shown while the pointer or focus rests on its tile, or `none`. */
let previewScene: BackdropScene | "none" | undefined;
/** Inline variables the last apply set, so a theme switch removes the ones the new theme does not set. */
const applied = new Set<string>();
const samples = new Map<string, string | null>();

/**
 * Where the chosen theme is kept for the next launch.
 *
 * Settings live in the engine's database, which the renderer can only read
 * over IPC — several frames after it has already painted. The first paint was
 * therefore always the stylesheet's own dark defaults, so a light app opened
 * dark and swapped once the answer arrived. This is read synchronously before
 * React renders.
 */
const THEME_KEY = "capsule.appearanceTheme";
/*
 * The resolved background too. The theme alone is not the colour: the palette
 * is a setting, and its dark background is #181818 while the stylesheet's own
 * default is #0a0a0a — so a first paint that knew only "dark" was visibly
 * darker than the app, and lightened as soon as settings arrived.
 */
const BACKGROUND_KEY = "capsule.appearanceBackground";

/**
 * Applies the last known theme before the first paint.
 *
 * `force` is for the website, which is dark and only dark: it is one designed
 * surface, drawn against a dark ground, and a visitor's system preference
 * recolouring it means half of them see a version nobody looked at.
 */
export function applyStoredTheme(force?: "dark" | "light"): void {
  if (typeof document === "undefined") return;
  if (force) {
    lockedTheme = force;
    document.documentElement.dataset.theme = force;
    document.documentElement.dataset.surface = force;
    return;
  }
  lockedTheme = undefined;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch {
    // Private windows and cleared site data: fall through to the system.
  }
  const theme: AppearanceTheme =
    stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.surface = resolvedTheme(theme);
  try {
    const background = localStorage.getItem(BACKGROUND_KEY);
    if (background) document.documentElement.style.background = background;
  } catch {
    // Without it the stylesheet's default shows for a frame; not fatal.
  }
}

/*
 * Set when the surface is not the app: the website, which is dark and only
 * dark. The landing page embeds the real app over a demo bridge, and that app
 * loads settings and applies them like any other — so without this the site
 * went light the moment the demo's "follow the system" theme arrived, a
 * second after painting dark.
 */
let lockedTheme: "dark" | "light" | undefined;

/** Show a theme for a moment, or go back to the chosen one with `undefined`. */
export function previewThemeId(id: string | undefined): void {
  if (previewTheme === id) return;
  previewTheme = id;
  applyAppearance(lastSettings);
}

/** Show a backdrop scene for a moment, or go back to the chosen one with `undefined`. */
export function previewBackdropScene(scene: BackdropScene | "none" | undefined): void {
  if (previewScene === scene) return;
  previewScene = scene;
  applyAppearance(lastSettings);
}

/** Which theme and backdrop are drawn now: the chosen ones, or a preview. */
function drawn(themes: ThemeState | undefined, mode: ThemeAppearance) {
  const preview = previewTheme ? themes?.themes.find((theme) => theme.id === previewTheme) : undefined;
  const appearance = preview?.appearance ?? mode;
  const theme = preview ?? themes?.themes.find((item) => item.id === themes[appearance]);
  let backdrop: BackdropView | undefined = themes?.backdrop[appearance];
  if (preview) {
    const merged = mergeBackdrop(appearance, preview.backdrop, themes?.selection.backdrop);
    backdrop = merged?.scene ? { scene: merged.scene, fit: merged.fit, opacity: merged.opacity, blur: merged.blur, dim: merged.dim } : undefined;
  }
  if (previewScene) {
    const base = backdrop ?? { fit: "cover" as const, opacity: 1, blur: 0, dim: 0 };
    backdrop = previewScene === "none" ? undefined : { fit: base.fit, opacity: base.opacity, blur: base.blur, dim: base.dim, scene: previewScene };
  }
  return { preview: Boolean(preview), appearance, theme, backdrop };
}

/** The worst colour of an image, sampled once per URL; the apply runs again when it arrives. */
function sampleImage(url: string, text: string): string | undefined {
  const key = `${url} ${text}`;
  if (samples.has(key)) return samples.get(key) ?? undefined;
  samples.set(key, null);
  if (typeof Image === "undefined") return undefined;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext("2d");
      context?.drawImage(image, 0, 0, 16, 16);
      const sample = context ? worstSample(context.getImageData(0, 0, 16, 16).data, text) : undefined;
      if (sample) {
        samples.set(key, sample);
        applyAppearance(lastSettings);
      }
    } catch {
      // A sample that cannot be read keeps the full veil.
    }
  };
  image.src = url;
  return undefined;
}

export function applyAppearance(settings: CapsuleSettings | undefined, themes?: ThemeState): void {
  if (typeof document === "undefined") return;
  if (lockedTheme) return;
  lastSettings = settings;
  if (themes) lastThemes = themes;
  if (typeof window !== "undefined" && !media) {
    media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", () => applyAppearance(lastSettings));
  }
  const root = document.documentElement;
  // Before settings arrive, follow the Mac rather than assuming dark.
  const theme: AppearanceTheme = settings?.appearanceTheme ?? "system";
  const mode = resolvedTheme(theme);
  const shown = drawn(lastThemes, mode);
  const palette = shown.appearance === "light" ? settings?.appearanceLight : settings?.appearanceDark;
  // A preview of the other appearance switches the stylesheet's tokens with it.
  root.dataset.theme = shown.preview ? shown.appearance : theme;
  root.dataset.surface = shown.appearance;
  if (!shown.preview) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // A theme that cannot be remembered still applies to this session.
    }
  }
  if (!palette) return;
  const vars = themeVars(palette, shown.theme);
  const customMono = sanitizeFontName(settings?.customCodeFont);
  if (customMono) {
    vars["--mono"] = `"${customMono}", ${CODE_FONT_STACKS[palette.codeFont]}`;
  }
  vars["--transcript-size"] = TRANSCRIPT_SIZE_CSS[settings?.transcriptSize ?? "m"];
  vars["--chat-max"] = TRANSCRIPT_WIDTH_CSS[settings?.transcriptWidth ?? "standard"];
  const page = pageColours(vars, shown.appearance);
  const images = typeof window !== "undefined" && window.capsule?.isDesktop === true;
  const imageUrl = images && !shown.backdrop?.scene ? shown.backdrop?.imageUrl : undefined;
  const paint = backdropPaint(shown.backdrop, page, { images, sample: imageUrl ? sampleImage(imageUrl, page.text) : undefined });
  Object.assign(vars, paint.vars);
  if (paint.mode) root.dataset.backdrop = paint.mode;
  else delete root.dataset.backdrop;
  for (const name of applied) {
    if (!(name in vars)) root.style.removeProperty(name);
  }
  applied.clear();
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
    applied.add(name);
  }
  root.style.background = vars["--bg"] ?? page.base;
  if (shown.preview) return;
  try {
    localStorage.setItem(BACKGROUND_KEY, page.base);
  } catch {
    // Remembered for the next launch when it can be; harmless when not.
  }
  // The window frame draws this before the renderer exists at all; it takes hex only.
  void window.capsule?.windowBackground?.(page.base);
}
