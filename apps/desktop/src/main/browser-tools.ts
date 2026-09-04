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

export interface BrowserTarget {
  /** The guest WebContents, or undefined when no page is open. */
  contents(): WebContents | undefined;
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
  return await Promise.race([
    contents.executeJavaScript(script, true),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error("The page did not answer in time.")), SCRIPT_TIMEOUT_MS),
    ),
  ]);
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
  const contents = target.contents();
  if (!contents) return noBrowser();
  try {
    await contents.loadURL(url);
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
  const push = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return;
    const label = (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.value ||
      el.innerText ||
      el.getAttribute("placeholder") ||
      ""
    ).trim().replace(/\\s+/g, " ").slice(0, 120);
    seen.push({
      ref: seen.length + 1,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || undefined,
      label,
      href: el.tagName === "A" ? el.getAttribute("href") || undefined : undefined,
    });
  };
  for (const el of document.querySelectorAll(
    'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [onclick]'
  )) {
    if (seen.length >= 200) break;
    push(el);
  }
  const text = (document.body ? document.body.innerText : "").replace(/\\n{3,}/g, "\\n\\n");
  return { url: location.href, title: document.title, text, elements: seen };
})()`;

export async function browserSnapshot(target: BrowserTarget): Promise<ToolResult> {
  const contents = target.contents();
  if (!contents) return noBrowser();
  try {
    const raw = (await runScript(contents, SNAPSHOT_SCRIPT)) as {
      url: string;
      title: string;
      text: string;
      elements: Array<{ ref: number; tag: string; label: string }>;
    };
    const truncated = raw.text.length > MAX_SNAPSHOT_CHARS;
    const text = truncated
      ? `${raw.text.slice(0, MAX_SNAPSHOT_CHARS)}\n… (page text truncated)`
      : raw.text;
    return {
      ok: true,
      detail: `${raw.title || "Untitled"} — ${raw.elements.length} interactive elements.`,
      data: { url: raw.url, title: raw.title, text, elements: raw.elements },
    };
  } catch (error) {
    return {
      ok: false,
      detail: `Could not read the page: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
