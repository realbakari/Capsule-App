import {
  appearanceCssVars,
  CODE_FONT_STACKS,
  sanitizeFontName,
  TRANSCRIPT_SIZE_CSS,
  TRANSCRIPT_WIDTH_CSS,
  type AppearanceTheme,
  type CapsuleSettings,
} from "@capsule/shared";

function resolvedTheme(theme: AppearanceTheme): "dark" | "light" {
  if (theme === "light") return "light";
  if (theme === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

let lastSettings: CapsuleSettings | undefined;
let media: MediaQueryList | undefined;

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

/** Applies the last known theme before the first paint. */
export function applyStoredTheme(): void {
  if (typeof document === "undefined") return;
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
}

export function applyAppearance(settings: CapsuleSettings | undefined): void {
  if (typeof document === "undefined") return;
  lastSettings = settings;
  if (typeof window !== "undefined" && !media) {
    media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", () => applyAppearance(lastSettings));
  }
  const root = document.documentElement;
  // Before settings arrive, follow the Mac rather than assuming dark.
  const theme: AppearanceTheme = settings?.appearanceTheme ?? "system";
  const mode = resolvedTheme(theme);
  const palette = mode === "light" ? settings?.appearanceLight : settings?.appearanceDark;
  root.dataset.theme = theme;
  root.dataset.surface = mode;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // A theme that cannot be remembered still applies to this session.
  }
  if (!palette) return;
  const vars = appearanceCssVars(palette);
  const customMono = sanitizeFontName(settings?.customCodeFont);
  if (customMono) {
    vars["--mono"] = `"${customMono}", ${CODE_FONT_STACKS[palette.codeFont]}`;
  }
  vars["--transcript-size"] = TRANSCRIPT_SIZE_CSS[settings?.transcriptSize ?? "m"];
  vars["--chat-max"] = TRANSCRIPT_WIDTH_CSS[settings?.transcriptWidth ?? "standard"];
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}
