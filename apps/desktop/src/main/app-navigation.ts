/*
 * The main window carries the full preload, so whatever document it shows can
 * reach every IPC channel, the terminal included. It must only ever show the
 * app itself: a file dropped outside a drop zone, or a link that escapes the
 * renderer's handlers, would otherwise load in its place with that power.
 */

/** True when `url` is the app's own document (any hash or query), not somewhere else. */
export function isAppDocument(url: string, appUrl: string): boolean {
  let target: URL;
  let app: URL;
  try {
    target = new URL(url);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  if (app.protocol === "file:") return target.protocol === "file:" && target.pathname === app.pathname;
  return target.origin === app.origin;
}

const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** The URL to hand to the OS for a link the app opens in a new window, or undefined to drop it. */
export function externalLinkTarget(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return EXTERNAL_SCHEMES.has(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
