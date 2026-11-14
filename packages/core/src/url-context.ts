import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { publicNetworkAddress } from "@capsule/buzz";
import type { UrlContext } from "@capsule/shared";

/**
 * `@url`: one page, fetched by the main process, as readable text.
 *
 * Private networks are off limits: a prompt is not a reason to let a page or a
 * pasted link reach the router, a cloud metadata address or another machine on
 * the LAN. The one exception is a local server the user names themselves by
 * typing `localhost`, `127.0.0.1` or `[::1]`; that grants loopback only, and
 * only for as long as redirects stay on loopback.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export const PRIVATE_URL_ERROR = "Capsule does not fetch private-network addresses. Type localhost to fetch a server on this computer.";

export interface UrlTarget { url: URL; loopback: boolean }

export function urlContextTarget(input: string): UrlTarget {
  const text = input.trim();
  if (!text) throw new Error("Type a web address.");
  let url: URL;
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(text) ? text : `https://${text}`); }
  catch { throw new Error(`That is not a web address: ${text.slice(0, 120)}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https pages can be attached.");
  if (url.username || url.password) throw new Error("Remove the user name and password from the address.");
  const host = bareHost(url);
  const loopback = LOOPBACK_HOSTS.has(host);
  if (!loopback && isIP(host) && !publicNetworkAddress(host)) throw new Error(PRIVATE_URL_ERROR);
  if (!loopback && !isIP(host) && (host.endsWith(".localhost") || host.endsWith(".local") || !host.includes("."))) throw new Error(PRIVATE_URL_ERROR);
  return { url, loopback };
}

function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
}

function loopbackAddress(address: string): boolean {
  return isIP(address) === 4 ? address.startsWith("127.") : address === "::1";
}

export function addressAllowed(address: string, loopback: boolean): boolean {
  return loopback ? loopbackAddress(address) : publicNetworkAddress(address);
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Tests resolve names without the network. */
  resolve?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

export async function fetchUrlContext(input: string, options: FetchOptions = {}): Promise<UrlContext> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let target = urlContextTarget(input);
    for (let redirects = 0; ; redirects++) {
      const response = await get(target, controller.signal, options.resolve ?? ((hostname) => dnsLookup(hostname, { all: true })));
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        const location = response.headers.location;
        if (!location || redirects >= MAX_REDIRECTS) throw new Error("The page redirected too many times.");
        const next = new URL(location, target.url);
        // A redirect may not widen what the user typed: loopback stays loopback only.
        const nextTarget = urlContextTarget(next.href);
        if (nextTarget.loopback && !target.loopback) throw new Error(PRIVATE_URL_ERROR);
        target = nextTarget;
        continue;
      }
      if (status < 200 || status >= 300) { response.resume(); throw new Error(`The page answered ${status}.`); }
      const type = String(response.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (type && !type.startsWith("text/") && !/^application\/(json|xml|xhtml\+xml|[\w.+-]*\+json)$/u.test(type)) {
        response.resume();
        throw new Error(`That address is not a text page (${type}).`);
      }
      const { body, truncated } = await readCapped(response, options.maxBytes ?? MAX_BYTES);
      const html = type === "text/html" || type === "application/xhtml+xml" || (!type && /<html[\s>]/iu.test(body));
      const page = html ? htmlToText(body) : { title: "", text: body };
      return { url: target.url.href, title: page.title || target.url.host, text: page.text, truncated };
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`The page did not answer within ${Math.round(timeoutMs / 1000)}s.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function get(target: UrlTarget, signal: AbortSignal, resolve: NonNullable<FetchOptions["resolve"]>): Promise<IncomingMessage> {
  const lookup: LookupFunction = (hostname, lookupOptions, callback) => {
    void resolve(hostname).then((addresses) => {
      if (!addresses.length) { callback(new Error("That address did not resolve."), "", 4); return; }
      if (addresses.some((item) => !addressAllowed(item.address, target.loopback))) { callback(new Error(PRIVATE_URL_ERROR), "", 4); return; }
      // Pin the checked address: no second resolution and no rebinding window.
      if (lookupOptions.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    }, () => callback(new Error("That address did not resolve."), "", 4));
  };
  return new Promise((resolvePromise, reject) => {
    const request = (target.url.protocol === "https:" ? httpsRequest : httpRequest)(target.url, {
      method: "GET",
      signal,
      lookup,
      // No cookies, credentials or referrer: this is a fresh, anonymous read.
      headers: { Accept: "text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.1", "Accept-Encoding": "identity", "User-Agent": "Capsule" },
    }, resolvePromise);
    request.on("error", (error) => reject(error.message === PRIVATE_URL_ERROR || error.message.startsWith("That address") ? error : new Error(`Could not fetch the page: ${error.message}`)));
    request.end();
  });
}

function readCapped(response: IncomingMessage, maxBytes: number): Promise<{ body: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    response.on("data", (chunk: Buffer) => {
      if (truncated) return;
      const room = maxBytes - size;
      if (chunk.length > room) {
        chunks.push(chunk.subarray(0, room));
        size = maxBytes;
        truncated = true;
        response.destroy();
        resolve({ body: Buffer.concat(chunks).toString("utf8"), truncated });
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    });
    response.on("end", () => { if (!truncated) resolve({ body: Buffer.concat(chunks).toString("utf8"), truncated }); });
    response.on("error", (error) => { if (!truncated) reject(error); });
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", mdash: "-", ndash: "-", hellip: "...", copy: "(c)" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Readable text from HTML: the main content when the page marks it, headings and list items kept, markup and scripts gone. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? "").replace(/\s+/gu, " ").trim();
  let body = html.replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<(script|style|noscript|svg|template|head|iframe|canvas|form)\b[\s\S]*?<\/\1\s*>/giu, "");
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1\s*>/iu.exec(body)?.[2];
  if (main && main.replace(/<[^>]+>/gu, "").trim().length > 200) body = main;
  else body = body.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1\s*>/giu, "");
  const text = body
    .replace(/<h([1-6])\b[^>]*>/giu, (_whole, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<li\b[^>]*>/giu, "\n- ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/li\s*>/giu, "")
    .replace(/<\/(tr|dd|dt)\s*>/giu, "\n")
    .replace(/<\/(p|div|section|article|main|h[1-6]|ul|ol|table|pre|blockquote|figure)\s*>/giu, "\n\n")
    .replace(/<\/t[dh]\s*>/giu, "\t")
    .replace(/<[^>]+>/gu, "");
  return {
    title,
    text: decodeEntities(text)
      .split("\n").map((line) => line.replace(/[ \t\u00a0]+/gu, " ").trim()).join("\n")
      .replace(/\n{3,}/gu, "\n\n").trim(),
  };
}
