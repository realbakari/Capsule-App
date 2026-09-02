import fs from "node:fs";
import path from "node:path";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

const AUTOMATIC_ICON_PATHS = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "src/favicon.svg",
  "src/favicon.ico",
  "src/app/favicon.ico",
  "icon.svg",
  "icon.png",
  "logo.svg",
  "logo.png",
  "assets/icon.svg",
  "assets/icon.png",
] as const;

export function isSupportedProjectIcon(filePath: string): boolean {
  return Boolean(MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()]);
}

function existingIcon(filePath: string): string | undefined {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size <= 2_000_000 && isSupportedProjectIcon(filePath)
      ? filePath
      : undefined;
  } catch {
    return undefined;
  }
}

export function resolveProjectIconPath(
  projectRoot?: string,
  customPath?: string,
): string | undefined {
  if (customPath) {
    const candidate = path.isAbsolute(customPath)
      ? path.normalize(customPath)
      : projectRoot
        ? path.resolve(projectRoot, customPath)
        : undefined;
    if (candidate) return existingIcon(candidate);
  }
  if (!projectRoot) return undefined;
  for (const relative of AUTOMATIC_ICON_PATHS) {
    const icon = existingIcon(path.resolve(projectRoot, relative));
    if (icon) return icon;
  }
  return undefined;
}

export function readProjectIconDataUrl(
  projectRoot?: string,
  customPath?: string,
): string | undefined {
  const resolved = resolveProjectIconPath(projectRoot, customPath);
  if (!resolved) return undefined;
  const mime = MIME_BY_EXTENSION[path.extname(resolved).toLowerCase()];
  if (!mime) return undefined;
  return `data:${mime};base64,${fs.readFileSync(resolved).toString("base64")}`;
}

