import { imageMimeFromFilename } from "@capsule/shared";
import { markdownFilePath, markdownHref } from "./markdown";

/*
 * Where a Markdown image comes from decides how it may load. The page's
 * content policy allows only bundled and data: images, so a project file is
 * read through the file-preview channel and a web image never loads by
 * itself: the reader chooses to open it in the sandboxed browser.
 */
export type MarkdownImageSource =
  | { kind: "data"; url: string }
  | { kind: "local"; path: string }
  | { kind: "remote"; url: string }
  | { kind: "none" };

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z\d+/=\s]+$/i;

export function markdownImageSource(src: string, baseUrl?: string): MarkdownImageSource {
  const trimmed = src.trim();
  if (DATA_IMAGE.test(trimmed)) return { kind: "data", url: trimmed };
  const url = markdownHref(trimmed, baseUrl);
  if (url) return { kind: "remote", url };
  const path = markdownFilePath(trimmed, baseUrl);
  return path && imageMimeFromFilename(path) ? { kind: "local", path } : { kind: "none" };
}

/** Short enough to sit in a placeholder, long enough to tell hosts apart. */
export function displayImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const rest = `${parsed.pathname}${parsed.search}`;
    const shown = `${parsed.host}${rest === "/" ? "" : rest}`;
    return shown.length > 72 ? `${shown.slice(0, 71)}…` : shown;
  } catch {
    return url.slice(0, 72);
  }
}

/**
 * A drawn diagram as an image for the zoom view. Diagrams size themselves to
 * their container; an image needs the drawing's own size from its viewBox.
 */
export function svgImageUrl(svg: string): string {
  const box = /viewBox="[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(svg);
  const sized = box
    ? svg.replace(/<svg\b[^>]*>/, (tag) => tag
      .replace(/\s(?:width|height)="[^"]*"/g, "")
      .replace(/\sstyle="[^"]*"/, "")
      .replace(/^<svg/, `<svg width="${box[1]}" height="${box[2]}"`))
    : svg;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
}

/*
 * An HTML block is previewed in a sandboxed frame with no network: its own
 * content policy blocks every fetch, so a page cannot phone home or reach a
 * local service, and the frame's sandbox keeps it away from Capsule and from
 * navigating the window. Scripts run only when the reader turns them on.
 */
export function htmlPreviewDocument(html: string, scripts: boolean): string {
  const policy = [
    "default-src 'none'",
    "img-src data:",
    "media-src data:",
    "font-src data:",
    "style-src 'unsafe-inline'",
    scripts ? "script-src 'unsafe-inline'" : "script-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  const body = html.replace(/^﻿?\s*<!doctype[^>]*>/i, "");
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta charset="utf-8">${body}`;
}

export const HTML_PREVIEW_SANDBOX = { off: "", on: "allow-scripts" } as const;
