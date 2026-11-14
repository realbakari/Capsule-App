import { contrastRatio, mixHex } from "./appearance.js";

/** Scenes Capsule draws itself, in CSS, from the theme's own tokens. */
export const BACKDROP_SCENES = ["grain", "mesh", "night", "dots", "paper"] as const;
export type BackdropScene = (typeof BACKDROP_SCENES)[number];

export const BACKDROP_FITS = ["cover", "contain", "tile"] as const;
export type BackdropFit = (typeof BACKDROP_FITS)[number];

export const BACKDROP_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"] as const;
export const MAX_BACKDROP_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_BACKDROP_BLUR = 40;

export interface BackdropLayer {
  /** `none` draws nothing, so settings can turn off a theme's backdrop. */
  scene?: BackdropScene | "none";
  /** A path relative to the theme file, or to the settings folder for settings. */
  image?: string;
  fit?: BackdropFit;
  opacity?: number;
  /** Pixels. */
  blur?: number;
  /** A veil of the page colour over the backdrop, 0 to 1. */
  dim?: number;
}

export interface ThemeBackdrop extends BackdropLayer {
  light?: BackdropLayer;
  dark?: BackdropLayer;
}

/** What one appearance draws, after the theme's and the settings' layers are merged. */
export interface EffectiveBackdrop {
  scene?: BackdropScene;
  /** The declared path, still unresolved. Main turns it into a URL or a problem. */
  image?: string;
  /** Where `image` is resolved from: the theme file's folder, or the settings folder. */
  imageBase?: "theme" | "settings";
  fit: BackdropFit;
  opacity: number;
  blur: number;
  dim: number;
}

export interface BackdropProblem {
  severity: "error" | "warning";
  key: string;
  message: string;
}

/**
 * The most each scene mixes the text colour into the page colour. The
 * readability check treats the whole backdrop as that colour, its worst case.
 */
export const SCENE_INK: Record<BackdropScene, number> = {
  grain: 0.1,
  mesh: 0.14,
  night: 0.16,
  dots: 0.18,
  paper: 0.08,
};

export const SCENE_LABELS: Record<BackdropScene, string> = {
  grain: "Grain",
  mesh: "Mesh",
  night: "Night",
  dots: "Dots",
  paper: "Paper",
};

const LAYER_FIELDS = ["scene", "image", "fit", "opacity", "blur", "dim"] as const;

const unit = { type: "number", minimum: 0, maximum: 1 };
const layerProperties = {
  scene: { enum: [...BACKDROP_SCENES, "none"] },
  image: { type: "string", maxLength: 1024, description: "A png, jpg, webp or gif file, relative to the theme file or the settings folder. Never a URL." },
  fit: { enum: [...BACKDROP_FITS] },
  opacity: unit,
  blur: { type: "number", minimum: 0, maximum: MAX_BACKDROP_BLUR },
  dim: unit,
};

/** The `backdrop` key, for both the settings registry and the theme file schema. */
export const BACKDROP_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: "What the conversation column draws behind the transcript and composer.",
  properties: {
    ...layerProperties,
    light: { type: "object", additionalProperties: false, properties: layerProperties },
    dark: { type: "object", additionalProperties: false, properties: layerProperties },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLayer(value: Record<string, unknown>, at: string, problems: BackdropProblem[]): BackdropLayer {
  const layer: BackdropLayer = {};
  const number = (key: "opacity" | "blur" | "dim", max: number) => {
    const raw = value[key];
    if (raw === undefined) return;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > max) {
      problems.push({ severity: "error", key: `${at}.${key}`, message: `${key} must be a number from 0 to ${max}.` });
      return;
    }
    layer[key] = raw;
  };
  if (value.scene !== undefined) {
    if (value.scene === "none" || (BACKDROP_SCENES as readonly unknown[]).includes(value.scene)) layer.scene = value.scene as BackdropLayer["scene"];
    else problems.push({ severity: "error", key: `${at}.scene`, message: `scene must be one of ${BACKDROP_SCENES.join(", ")} or none.` });
  }
  if (value.image !== undefined) {
    const image = typeof value.image === "string" ? value.image.trim() : "";
    if (!image || image.length > 1024) problems.push({ severity: "error", key: `${at}.image`, message: "image must be a file path." });
    else if (/^[a-z][a-z0-9+.-]*:/i.test(image) && !/^[a-z]:[\\/]/i.test(image)) {
      problems.push({ severity: "error", key: `${at}.image`, message: "image must be a file on this computer, not a URL." });
    } else layer.image = image;
  }
  if (layer.scene && layer.image) {
    problems.push({ severity: "warning", key: `${at}.scene`, message: "A backdrop draws an image or a scene, not both. The image is used." });
    delete layer.scene;
  }
  if (value.fit !== undefined) {
    if ((BACKDROP_FITS as readonly unknown[]).includes(value.fit)) layer.fit = value.fit as BackdropFit;
    else problems.push({ severity: "error", key: `${at}.fit`, message: `fit must be one of ${BACKDROP_FITS.join(", ")}.` });
  }
  number("opacity", 1);
  number("blur", MAX_BACKDROP_BLUR);
  number("dim", 1);
  for (const key of Object.keys(value)) {
    if (!(LAYER_FIELDS as readonly string[]).includes(key) && !(at === "backdrop" && (key === "light" || key === "dark"))) {
      problems.push({ severity: "warning", key: `${at}.${key}`, message: `Unknown key "${key}" is ignored.` });
    }
  }
  return layer;
}

/** A `backdrop` value from a theme file or settings. A wrong field is dropped on its own. */
export function parseBackdrop(value: unknown, at = "backdrop"): { backdrop?: ThemeBackdrop; problems: BackdropProblem[] } {
  const problems: BackdropProblem[] = [];
  if (value === undefined) return { problems };
  if (!isRecord(value)) return { problems: [{ severity: "error", key: at, message: "backdrop must be an object." }] };
  const backdrop: ThemeBackdrop = parseLayer(value, at, problems);
  for (const appearance of ["light", "dark"] as const) {
    const raw = value[appearance];
    if (raw === undefined) continue;
    if (!isRecord(raw)) problems.push({ severity: "error", key: `${at}.${appearance}`, message: `${appearance} must be an object.` });
    else backdrop[appearance] = parseLayer(raw, `${at}.${appearance}`, problems);
  }
  return { backdrop, problems };
}

export function backdropHasImage(backdrop: ThemeBackdrop | undefined): boolean {
  return Boolean(backdrop?.image || backdrop?.light?.image || backdrop?.dark?.image);
}

/** A share string never carries a path from someone's disk. */
export function stripBackdropImages(backdrop: ThemeBackdrop | undefined): ThemeBackdrop | undefined {
  if (!backdrop) return undefined;
  const strip = (layer: BackdropLayer): BackdropLayer => {
    const { image: _image, ...rest } = layer;
    return rest;
  };
  const next: ThemeBackdrop = strip(backdrop);
  if (backdrop.light) next.light = strip(backdrop.light);
  if (backdrop.dark) next.dark = strip(backdrop.dark);
  return next;
}

/**
 * Layers apply lowest first: the theme's, its appearance's, then the
 * settings' and theirs. Each field replaces the one below, except that a layer
 * naming a scene or an image replaces both, since a backdrop draws one thing.
 */
export function mergeBackdrop(
  appearance: "light" | "dark",
  theme: ThemeBackdrop | undefined,
  settings: ThemeBackdrop | undefined,
): EffectiveBackdrop | undefined {
  let scene: BackdropLayer["scene"];
  let image: string | undefined;
  let imageBase: EffectiveBackdrop["imageBase"];
  const merged: Pick<EffectiveBackdrop, "fit" | "opacity" | "blur" | "dim"> = { fit: "cover", opacity: 1, blur: 0, dim: 0 };
  const layers: Array<[BackdropLayer | undefined, "theme" | "settings"]> = [
    [theme, "theme"],
    [theme?.[appearance], "theme"],
    [settings, "settings"],
    [settings?.[appearance], "settings"],
  ];
  for (const [layer, base] of layers) {
    if (!layer) continue;
    if (layer.scene !== undefined || layer.image !== undefined) {
      scene = layer.scene;
      image = layer.image;
      imageBase = layer.image ? base : undefined;
    }
    if (layer.fit !== undefined) merged.fit = layer.fit;
    if (layer.opacity !== undefined) merged.opacity = layer.opacity;
    if (layer.blur !== undefined) merged.blur = layer.blur;
    if (layer.dim !== undefined) merged.dim = layer.dim;
  }
  if (image) return { image, imageBase, ...merged };
  if (scene && scene !== "none") return { scene, ...merged };
  return undefined;
}

/** The colour a scene comes closest to the text with, for the readability check. */
export function sceneSample(scene: BackdropScene, base: string, text: string): string {
  return mixHex(base, text, SCENE_INK[scene]);
}

export const MIN_BACKDROP_CONTRAST = 4.5;

/**
 * How much of the page colour to lay over the backdrop, 0 to 1. Never less
 * than the person's own `dim`, and enough that text over the backdrop's worst
 * colour keeps `minContrast`, or the contrast of the bare page when the theme
 * itself falls short of it. All colours are opaque `#rrggbb`.
 */
export function backdropScrim(input: {
  text: string;
  base: string;
  sample: string;
  opacity: number;
  dim: number;
  minContrast?: number;
}): number {
  const dim = Math.max(0, Math.min(1, input.dim));
  const target = Math.min(input.minContrast ?? MIN_BACKDROP_CONTRAST, contrastRatio(input.text, input.base));
  const shown = mixHex(input.base, input.sample, Math.max(0, Math.min(1, input.opacity)));
  const readable = (veil: number) => contrastRatio(input.text, mixHex(shown, input.base, veil)) >= target - 1e-9;
  if (readable(dim)) return dim;
  let low = dim;
  let high = 1;
  for (let i = 0; i < 20; i++) {
    const middle = (low + high) / 2;
    if (readable(middle)) high = middle;
    else low = middle;
  }
  return Math.ceil(high * 100) / 100;
}
