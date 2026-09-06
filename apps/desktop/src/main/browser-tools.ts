import type { WebContents } from "electron";

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
  /** The guest WebContents, or undefined when no page is open. */
  contents(): WebContents | undefined;
  /** Create the first guest and navigate it to this URL. Never launches the system browser. */
  open?(url: string): Promise<WebContents | undefined>;
}

export interface ToolResult {
  ok: boolean;
  /** What happened, phrased for the agent reading it. */
  detail: string;
  /** Structured payload, when the tool produces one. */
  data?: unknown;
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
  return { url: parsed.toString(), detail: "" };
}

async function runScript(contents: WebContents, script: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      contents.executeJavaScript(script, true),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("The page did not answer in time.")), SCRIPT_TIMEOUT_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

/** What is on screen, without pretending to know more than the page says. */
export async function browserStatus(target: BrowserTarget): Promise<ToolResult> {
  const contents = target.contents();
  if (!contents) return noBrowser();
  const url = contents.getURL();
  const title = contents.getTitle();
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
    if (existing) await contents.loadURL(url);
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

/*
 * The page as text, plus what can be clicked.
 *
 * Coordinates are the wrong currency for an agent: they change with every
 * resize and say nothing about what is under them. This returns the page's
 * visible text and a numbered list of its interactive elements, so a later
 * click names a thing rather than a pixel.
 */
const SNAPSHOT_SCRIPT = `(() => {
  const seen = [];
  let truncated = false;
  let elementChars = 0;
  const clip = (value, limit) => {
    const text = String(value || "");
    if (text.length > limit) truncated = true;
    return text.slice(0, limit);
  };
  const push = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return;
    const label = (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      (el.type === "password" ? "" : el.value) ||
      el.innerText ||
      el.getAttribute("placeholder") ||
      ""
    ).trim().replace(/\\s+/g, " ").slice(0, 120);
    const item = {
      ref: seen.length + 1,
      tag: el.tagName.toLowerCase(),
      type: clip(el.getAttribute("type"), 40) || undefined,
      label,
      href: el.tagName === "A" ? clip(el.getAttribute("href"), 1024) || undefined : undefined,
    };
    elementChars += JSON.stringify(item).length;
    if (elementChars <= 24000) seen.push(item);
    else truncated = true;
  };
  for (const el of document.querySelectorAll(
    'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick]'
  )) {
    if (seen.length >= 200 || elementChars > 24000) { truncated = true; break; }
    push(el);
  }
  const body = document.body ? document.body.innerText : "";
  const text = body.slice(0, ${MAX_SNAPSHOT_CHARS}).replace(/\\n{3,}/g, "\\n\\n");
  return { url: clip(location.href, 2048), title: clip(document.title, 512), text, truncated: truncated || body.length > ${MAX_SNAPSHOT_CHARS}, elements: seen };
})()`;

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
    url: clip(raw.url, 2048), title: clip(raw.title, 512), text: clip(raw.text, MAX_SNAPSHOT_CHARS),
    elements: source.slice(0, 200).map((value, index) => {
      const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      return { ref: index + 1, tag: clip(item.tag, 40), type: clip(item.type, 40) || undefined, label: clip(item.label, 120), href: clip(item.href, 1024) || undefined };
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
    const raw = (await runScript(contents, SNAPSHOT_SCRIPT)) as Record<string, unknown>;
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
