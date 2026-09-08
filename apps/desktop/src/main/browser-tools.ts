import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { BROWSER_WORLD, snapshotScript, actionScript, type BrowserAction } from "./browser-page";
import { browserLoadFailure } from "./browser-diagnostics";

/*
 * The browser, as something an agent can use.
 *
 * Capsule's browser pane is an Electron <webview>, which is a guest
 * WebContents the main process can reach by id. So the agent-facing tools live
 * here rather than in the renderer: no round trip, and the renderer cannot be
 * mid-render when a tool is called.
 *
 * Every tool answers in words the agent can act on. A tool that returns "false"
 * or a bare error code teaches an agent nothing; one that says which page is
 * open, or that no page is open yet and what to call first, lets it recover
 * without a human.
 */

/** How long a script may run in the page before the tool gives up. */
const SCRIPT_TIMEOUT_MS = 10_000;
/** A page's text is context, not a document dump. */
const MAX_SNAPSHOT_CHARS = 20_000;
const MAX_SNAPSHOT_BYTES = 96_000;

export interface BrowserTarget {
  /** Recheck the thread grant after asynchronous work. */
  check?(): void;
  /** The guest WebContents, or undefined when no page is open. */
  contents(): WebContents | undefined;
  /** Create the first guest and navigate it to this URL. Never launches the system browser. */
  open?(url: string, owner?: string): Promise<WebContents | undefined>;
}

export interface ToolResult {
  ok: boolean;
  /** What happened, phrased for the agent reading it. */
  detail: string;
  /** Structured payload, when the tool produces one. */
  data?: unknown;
  image?: { data: string; mimeType: "image/jpeg" };
}

/** The answer when there is no page, which is a state and not a failure. */
export function noBrowser(): ToolResult {
  return {
    ok: false,
    detail:
      "No browser page is open in Capsule. Ask the person to open the Browser panel, " +
      "or call browser_navigate with a URL to open one.",
  };
}

/*
 * `http(s)` only, and never a local file.
 *
 * A tool that will open any URL the model produces is a way to read the disk
 * (`file:///Users/...`) or to reach a privileged scheme, from a string that may
 * itself have come off a web page. Refusing here is cheaper than auditing every
 * path that can reach it.
 */
export function readNavigableUrl(raw: unknown): { url?: string; detail: string } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { detail: "Pass a url, for example https://example.com." };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { detail: `Not a URL: ${raw}. Include the scheme, as in https://example.com.` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      detail: `Capsule's browser opens http and https only, not ${parsed.protocol.replace(":", "")}.`,
    };
  }
  if (parsed.username || parsed.password || raw.length > 2048) return { detail: "Use a URL under 2048 characters without embedded credentials." };
  return { url: parsed.toString(), detail: "" };
}

export async function boundedBrowserOperation<T>(operation: Promise<T>, timeoutMs = SCRIPT_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("The page did not answer in time.")), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}


export function runBrowserScript(contents: WebContents, script: string): Promise<unknown> {
  return boundedBrowserOperation(contents.executeJavaScriptInIsolatedWorld(BROWSER_WORLD, [{ code: script }]));
}

/** What is on screen, without pretending to know more than the page says. */
export async function browserStatus(target: BrowserTarget): Promise<ToolResult> {
  const contents = target.contents();
  if (!contents) return noBrowser();
  const url = contents.getURL().slice(0, 2048);
  const title = contents.getTitle().slice(0, 512);
  return {
    ok: true,
    detail: url ? `Showing ${title || "an untitled page"} at ${url}.` : "The browser is open with no page loaded.",
    data: { url, title, loading: contents.isLoading() },
  };
}

export async function browserNavigate(target: BrowserTarget, raw: unknown): Promise<ToolResult> {
  const { url, detail } = readNavigableUrl(raw);
  if (!url) return { ok: false, detail };
  try {
    const existing = target.contents();
    const contents = existing ?? await target.open?.(url);
    if (!contents) return { ok: false, detail: "Could not open the embedded browser. Open Capsule’s Browser panel, then retry navigation." };
    // Opening the first guest already navigates it. Do not reload that page
    // after dom-ready (which would repeat page-start side effects).
    if (existing) await boundedBrowserOperation(contents.loadURL(url));
    target.check?.();
    const failure = browserLoadFailure(contents);
    if (failure) throw new Error(failure);
    return { ok: true, detail: `Opened ${url}.`, data: { url: contents.getURL() } };
  } catch (error) {
    /*
     * A failed load is the page's answer, not a broken tool: a 404 or a
     * refused connection is something the agent should read and act on.
     */
    return {
      ok: false,
      detail: `Could not open ${url}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Validate and bound again at the process boundary; page script output is untrusted. */
export function boundedBrowserSnapshot(raw: Record<string, unknown>) {
  let truncated = Boolean(raw.truncated);
  const clip = (value: unknown, limit: number) => {
    const text = typeof value === "string" ? value : "";
    if (text.length > limit) truncated = true;
    return text.slice(0, limit);
  };
  const source = Array.isArray(raw.elements) ? raw.elements : [];
  if (source.length > 200) truncated = true;
  const data = {
    snapshotId: clip(raw.snapshotId, 64),
    url: clip(raw.url, 2048), title: clip(raw.title, 512), text: clip(raw.text, MAX_SNAPSHOT_CHARS),
    elements: source.slice(0, 200).map((value, index) => {
      const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      const options = Array.isArray(item.options) ? item.options.slice(0, 30).map((value) => {
        const option = value && typeof value === "object" ? value as Record<string, unknown> : {};
        return { value: clip(option.value, 120), label: clip(option.label, 120), disabled: option.disabled === true };
      }) : undefined;
      return { ref: index + 1, disabled: item.disabled === true, tag: clip(item.tag, 40), type: clip(item.type, 40) || undefined, label: clip(item.label, 120), href: clip(item.href, 1024) || undefined, options };
    }),
    truncated: false,
  };
  while (Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_SNAPSHOT_BYTES) {
    truncated = true;
    if (data.elements.length) data.elements.pop();
    else data.text = data.text.slice(0, Math.floor(data.text.length / 2));
  }
  data.truncated = truncated;
  return data;
}

export async function browserSnapshot(target: BrowserTarget): Promise<ToolResult> {
  const contents = target.contents();
  if (!contents) return noBrowser();
  try {
    const raw = (await runBrowserScript(contents, snapshotScript(randomUUID()))) as Record<string, unknown>;
    target.check?.();
    if (!raw || typeof raw !== "object") throw new Error("The page returned an invalid snapshot.");
    const data = boundedBrowserSnapshot(raw);
    return {
      ok: true,
      detail: `${data.title || "Untitled"} — ${data.elements.length} interactive elements.${data.truncated ? " Snapshot truncated to its context budget." : ""}`,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `Could not read the page: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Reference actions never resolve an old ref against a newly enumerated page. */
export async function browserInteract(target: BrowserTarget, input: BrowserAction): Promise<ToolResult> {
  const contents = target.contents();
  if (!contents) return noBrowser();
  if (typeof input.snapshotId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(input.snapshotId) || !Number.isInteger(input.ref) || input.ref < 1 || input.ref > 200) {
    return { ok: false, detail: "Use snapshotId and ref from the latest browser_snapshot." };
  }
  if ((input.action === "type" || input.action === "select") && (typeof input.text !== "string" || input.text.length > 10_000)) {
    return { ok: false, detail: "Provide text with at most 10,000 characters." };
  }
  await runBrowserScript(contents, actionScript(input));
  target.check?.();
  return { ok: true, detail: `Browser ${input.action} dispatched. Take a snapshot to check the result; dispatch is not verification.` };
}

export async function browserScroll(target: BrowserTarget, deltaY: unknown): Promise<ToolResult> {
  if (typeof deltaY !== "number" || !Number.isFinite(deltaY) || Math.abs(deltaY) > 5000) return { ok: false, detail: "deltaY must be a number between -5000 and 5000 CSS pixels." };
  const contents = target.contents();
  if (!contents) return noBrowser();
  await runBrowserScript(contents, `window.scrollBy({top:${deltaY},behavior:"instant"});`);
  target.check?.();
  return { ok: true, detail: "Scrolled the page. Take a new snapshot to inspect it." };
}

export async function browserPress(target: BrowserTarget, args: { snapshotId: string; ref: number; key: unknown }): Promise<ToolResult> {
  const keys = ["Enter", "Escape", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"];
  if (typeof args.key !== "string" || !keys.includes(args.key)) return { ok: false, detail: `key must be one of: ${keys.join(", ")}. Modifier shortcuts are not supported.` };
  const contents = target.contents();
  if (!contents) return noBrowser();
  const result = await browserInteract(target, { ...args, action: "focus" });
  if (!result.ok) return result;
  // Focusing yields to the page. A replacement guest must not receive a key
  // intended for the old one, even if it belongs to the same thread.
  if (target.contents() !== contents) return { ok: false, detail: "The browser page changed before the key could be sent. Take a new snapshot." };
  const keyCode = args.key === "Space" ? " " : args.key;
  contents.sendInputEvent({ type: "keyDown", keyCode });
  contents.sendInputEvent({ type: "keyUp", keyCode });
  return { ok: true, detail: `Pressed ${args.key}. Take a snapshot to check the result.` };
}

export async function browserScreenshot(target: BrowserTarget): Promise<ToolResult> {
  const contents = target.contents();
  if (!contents) return noBrowser();
  let image = await boundedBrowserOperation(contents.capturePage());
  target.check?.();
  if (image.isEmpty()) return { ok: false, detail: "The browser has no visible pixels to capture yet." };
  const size = image.getSize();
  const ratio = Math.min(1, 1280 / Math.max(size.width, size.height));
  if (ratio < 1) image = image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)) });
  const bytes = image.toJPEG(75);
  if (bytes.length > 1_500_000) return { ok: false, detail: "Screenshot exceeded the image budget. Reduce the browser viewport and retry." };
  return { ok: true, detail: "Captured the current viewport (not the full page). Visible page content may be sensitive.", data: image.getSize(), image: { data: bytes.toString("base64"), mimeType: "image/jpeg" } };
}
