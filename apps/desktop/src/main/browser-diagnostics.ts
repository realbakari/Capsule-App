import type { WebContents } from "electron";

interface PageDiagnostic { kind: "console" | "load" | "crash"; detail: string; at: string }
const entries = new WeakMap<WebContents, PageDiagnostic[]>();
const loadFailures = new WeakMap<WebContents, string>();
const LIMIT = 80;

/** On-demand page diagnostics, never persisted and never a full network/body log. */
export function observeBrowser(contents: WebContents): void {
  if (entries.has(contents)) return;
  const ring: PageDiagnostic[] = [];
  entries.set(contents, ring);
  const append = (kind: PageDiagnostic["kind"], detail: string) => {
    ring.push({ kind, detail: detail.slice(0, 1500), at: new Date().toISOString() });
    if (ring.length > LIMIT) ring.shift();
  };
  contents.on("console-message", (_event, level, message) => {
    append("console", `${level}: ${message}`);
  });
  contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (code !== -3) append("load", `${isMainFrame ? "Page" : "Subframe"} load failed (${code}): ${description}`);
    if (isMainFrame && code !== -3) loadFailures.set(contents, description);
  });
  contents.on("render-process-gone", (_event, details) => append("crash", `Page process ended: ${details.reason}`));
  contents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) { ring.length = 0; loadFailures.delete(contents); }
  });
}

export function browserLoadFailure(contents: WebContents): string | undefined {
  return loadFailures.get(contents);
}

export function browserDiagnostics(contents: WebContents): PageDiagnostic[] {
  return (entries.get(contents) ?? []).map((entry) => ({ ...entry }));
}
