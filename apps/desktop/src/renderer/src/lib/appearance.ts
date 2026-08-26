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

export function applyAppearance(settings: CapsuleSettings | undefined): void {
  if (typeof document === "undefined") return;
  lastSettings = settings;
  if (typeof window !== "undefined" && !media) {
    media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", () => applyAppearance(lastSettings));
  }
  const root = document.documentElement;
  const theme: AppearanceTheme = settings?.appearanceTheme ?? "dark";
  const mode = resolvedTheme(theme);
  const palette = mode === "light" ? settings?.appearanceLight : settings?.appearanceDark;
  root.dataset.theme = theme;
  root.dataset.surface = mode;
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
