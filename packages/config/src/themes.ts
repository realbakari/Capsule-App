import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  BACKDROP_IMAGE_EXTENSIONS,
  BACKDROP_SCHEME,
  BUNDLED_THEMES,
  MAX_BACKDROP_IMAGE_BYTES,
  mergeBackdrop,
  resolveThemeTokens,
  themeContrastWarnings,
  parseTheme,
  type BackdropView,
  type ConfigProblem,
  type Theme,
  type ThemeAppearance,
  type ThemeProblem,
  type ThemeSelection,
  type ThemeSource,
  type ThemeState,
  type ThemeSummary,
} from "@capsule/shared";
import { parseJsonc } from "./jsonc.js";
import type { ResourceFile } from "./resources.js";

/** A theme that can be picked, and the file it came from. */
export interface ThemeEntry {
  theme: Theme;
  source: ThemeSource;
  path?: string;
  problems: ThemeProblem[];
}

export interface ThemeCatalog {
  /** One entry per id, the highest-precedence file's. */
  themes: ThemeEntry[];
  problems: ConfigProblem[];
}

const BUILTIN_IDS: Record<ThemeAppearance, string> = { light: "capsule-light", dark: "capsule-dark" };

/**
 * Theme files in precedence order: the project's, the user's, plugins', then
 * the bundled themes. An id's first theme wins, and a file named after a
 * bundled theme replaces it. A file is named by its path below `themes/`.
 */
export function readThemeCatalog(files: readonly ResourceFile[], pluginThemes: readonly ThemeEntry[] = []): ThemeCatalog {
  const problems: ConfigProblem[] = [];
  const winners = new Map<string, ThemeEntry>();
  const ordered = [...files.filter((file) => file.scope === "project"), ...files.filter((file) => file.scope === "user")];
  const fromFiles: ThemeEntry[] = [];
  for (const file of ordered) {
    const read = parseJsonc(file.text);
    if (read.state !== "ok") {
      const where = read.state === "broken" ? ` Line ${read.error.line}, column ${read.error.column}.` : "";
      problems.push({ severity: "error", path: file.path, message: `${read.state === "broken" ? read.error.message : "The file could not be read."}${where}` });
      continue;
    }
    const parsed = parseTheme(read.value, file.name);
    for (const problem of parsed.problems) problems.push({ severity: problem.severity, path: file.path, ...(problem.key ? { key: problem.key } : {}), message: problem.message });
    if (parsed.theme) fromFiles.push({ theme: parsed.theme, source: file.scope, path: file.path, problems: parsed.problems });
  }
  const bundled = BUNDLED_THEMES.map((theme): ThemeEntry => ({ theme, source: "bundled", problems: [] }));
  for (const entry of [...fromFiles, ...pluginThemes, ...bundled]) {
    const winner = winners.get(entry.theme.id);
    if (!winner) {
      winners.set(entry.theme.id, entry);
    } else if (entry.path) {
      problems.push({ severity: "warning", path: entry.path, message: `The theme "${entry.theme.id}" is also defined in ${winner.path}, which takes precedence, so this file is not used.` });
    }
  }
  return { themes: [...winners.values()], problems };
}

/**
 * Backdrop image files main is willing to serve, each under a token that
 * changes with the file, so the renderer never names a path and a replaced
 * file is never served from a stale cache.
 */
export class BackdropImages {
  private readonly served = new Map<string, string>();

  /** The checked file for a token from a `capsule-backdrop:` URL. */
  file(token: string): string | undefined {
    return this.served.get(token);
  }

  /**
   * An image path from a theme or settings, resolved against `base` and
   * accepted only inside one of `roots`, through realpath, so a link cannot
   * lead out. Remote addresses never get here: the parser refuses them.
   */
  check(image: string, base: string, roots: readonly string[]): { url: string; name: string } | { problem: string } {
    const expanded = image.startsWith("~/") ? path.join(homedir(), image.slice(2)) : image;
    let file: string;
    try {
      file = realpathSync(path.resolve(base, expanded));
    } catch {
      return { problem: `The backdrop image ${image} was not found.` };
    }
    const inside = roots.some((root) => {
      let real: string;
      try {
        real = realpathSync(root);
      } catch {
        return false;
      }
      const relative = path.relative(real, file);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
    if (!inside) return { problem: `The backdrop image ${image} is outside the settings folder and the theme's folder, so it is not loaded.` };
    const extension = path.extname(file).toLowerCase();
    if (!(BACKDROP_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
      return { problem: `The backdrop image ${image} is not a png, jpg, webp or gif file.` };
    }
    let size: number;
    let changed: number;
    try {
      const stat = statSync(file);
      if (!stat.isFile()) return { problem: `The backdrop image ${image} is not a file.` };
      size = stat.size;
      changed = stat.mtimeMs;
    } catch {
      return { problem: `The backdrop image ${image} could not be read.` };
    }
    if (size > MAX_BACKDROP_IMAGE_BYTES) return { problem: `The backdrop image ${image} is larger than 8 MB.` };
    const token = createHash("sha1").update(`${file}\0${size}\0${changed}`).digest("hex").slice(0, 24) + extension;
    this.served.set(token, file);
    return { url: `${BACKDROP_SCHEME}://image/${token}`, name: path.basename(file) };
  }
}

export interface ThemeStateInput {
  catalog: ThemeCatalog;
  selection?: ThemeSelection;
  overrides: Readonly<Record<string, Record<string, string>>>;
  userDir: string;
  /** The file `theme` was read from, for problems about the selection. */
  settingsPath: string;
  images: BackdropImages;
}

/** What the renderer needs to draw both appearances, and what went wrong choosing it. */
export function buildThemeState(input: ThemeStateInput): { state: ThemeState; problems: ConfigProblem[] } {
  const { catalog, selection, overrides } = input;
  const problems: ConfigProblem[] = [...catalog.problems];
  const themes: ThemeSummary[] = catalog.themes.map(({ theme, source, path: file, problems: themeProblems }) => {
    const own = overrides[theme.id] ?? {};
    const resolved = resolveThemeTokens(theme, theme.appearance, own);
    const tokens = Object.fromEntries(Object.entries(resolved).filter(([token]) => token in theme.tokens || token in own || `--${token}` in own));
    return {
      id: theme.id,
      name: theme.name,
      appearance: theme.appearance,
      source,
      ...(file ? { path: file } : {}),
      builtin: theme.id === BUILTIN_IDS.light || theme.id === BUILTIN_IDS.dark,
      tokens,
      ...(theme.backdrop ? { backdrop: theme.backdrop } : {}),
      problems: themeProblems,
      contrast: themeContrastWarnings(resolved),
    };
  });

  const pick = (appearance: ThemeAppearance): string => {
    const wanted = selection?.[appearance];
    if (!wanted) return BUILTIN_IDS[appearance];
    const found = themes.find((theme) => theme.id === wanted);
    if (!found) {
      problems.push({ severity: "warning", path: input.settingsPath, key: `theme.${appearance}`, message: `There is no theme "${wanted}". Capsule uses ${BUILTIN_IDS[appearance]} instead.` });
      return BUILTIN_IDS[appearance];
    }
    if (found.appearance !== appearance) {
      problems.push({ severity: "warning", path: input.settingsPath, key: `theme.${appearance}`, message: `"${wanted}" is a ${found.appearance} theme, so it cannot be the ${appearance} one. Capsule uses ${BUILTIN_IDS[appearance]} instead.` });
      return BUILTIN_IDS[appearance];
    }
    return wanted;
  };
  const light = pick("light");
  const dark = pick("dark");

  const view = (appearance: ThemeAppearance, id: string): BackdropView | undefined => {
    const entry = catalog.themes.find((item) => item.theme.id === id);
    const merged = mergeBackdrop(appearance, entry?.theme.backdrop, selection?.backdrop);
    if (!merged) return undefined;
    const { image, imageBase, ...rest } = merged;
    if (!image) return rest;
    const fromTheme = imageBase === "theme" && entry?.path;
    const base = fromTheme ? path.dirname(entry.path!) : input.userDir;
    const roots = fromTheme ? [input.userDir, path.dirname(entry.path!)] : [input.userDir];
    const checked = imageBase === "theme" && !entry?.path
      ? { problem: `The bundled theme ${id} cannot name an image.` }
      : input.images.check(image, base, roots);
    if ("problem" in checked) {
      problems.push({ severity: "warning", path: fromTheme ? entry.path! : input.settingsPath, key: "backdrop.image", message: `${checked.problem} No image is drawn.` });
      return undefined;
    }
    return { ...rest, imageUrl: checked.url, imageName: checked.name };
  };

  const backdrop = { light: view("light", light), dark: view("dark", dark) };
  const unique = problems.filter((problem, index) => problems.findIndex((other) => other.path === problem.path && other.message === problem.message) === index);
  return { state: { light, dark, themes, backdrop }, problems: unique };
}
