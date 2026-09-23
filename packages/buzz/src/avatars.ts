import { lookup } from "node:dns/promises";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";
import { BlockList, isIP } from "node:net";

const MAX_BYTES = 256 * 1024;
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) blocked.addSubnet(address, prefix, "ipv6");

export function publicAvatarAddress(address: string): boolean {
  return isIP(address) === 4 ? !blocked.check(address, "ipv4")
    : isIP(address) === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

/** Only an explicitly connected relay may supply private-network images.
 * Other profile hosts must be public HTTPS, including every redirect/DNS result. */
export function avatarUrl(picture: string, relay: string): URL {
  if (picture.length > 4096) throw new Error("Oversized profile URL");
  const url = new URL(picture, relay);
  const sameOrigin = url.origin === relay;
  if (url.username || url.password || (url.protocol !== "https:" && !(sameOrigin && url.protocol === "http:"))) throw new Error("Unsupported profile URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!sameOrigin && isIP(host) && !publicAvatarAddress(host)) throw new Error("Private profile host");
  return url;
}

export function rasterData(bytes: Buffer, contentType: string): string | undefined {
  if (!bytes.length || bytes.length > MAX_BYTES) return;
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  const valid = type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : type === "image/gif" ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())
        : type === "image/webp" && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  return valid ? `data:${type};base64,${bytes.toString("base64")}` : undefined;
}

async function download(picture: string, relay: string, signal: AbortSignal, redirects = 0): Promise<string | undefined> {
  if (signal.aborted) return;
  const inline = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=]+)$/i.exec(picture);
  if (inline) return picture.length <= MAX_BYTES * 1.4 ? rasterData(Buffer.from(inline[2]!, "base64"), inline[1]!) : undefined;
  const url = avatarUrl(picture, relay);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsGet : httpGet)(url, {
      signal,
      // Do not send relay credentials, cookies, or a referrer to image hosts.
      headers: { Accept: "image/png,image/jpeg,image/webp,image/gif", "Accept-Encoding": "identity" },
      lookup(hostname, options, callback) {
        void lookup(hostname, { all: true }).then((addresses) => {
          if (!addresses.length || (url.origin !== relay && addresses.some((item) => !publicAvatarAddress(item.address)))) {
            callback(new Error("Private profile host"), "", 4); return;
          }
          // Pin the validated address; no second resolution/rebinding window.
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0]!.address, addresses[0]!.family);
        }, () => callback(new Error("Profile host unavailable"), "", 4));
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        response.destroy();
        if (redirects >= 2 || !response.headers.location) { resolve(undefined); return; }
        try { void download(new URL(response.headers.location, url).href, relay, signal, redirects + 1).then(resolve, reject); }
        catch { resolve(undefined); }
        return;
      }
      if (response.statusCode !== 200 || Number(response.headers["content-length"]) > MAX_BYTES) { response.destroy(); resolve(undefined); return; }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { response.destroy(); resolve(undefined); } else chunks.push(chunk);
      });
      response.on("end", () => resolve(rasterData(Buffer.concat(chunks), String(response.headers["content-type"] ?? ""))));
      response.on("error", reject);
      response.on("aborted", () => resolve(undefined));
    });
    request.on("error", reject);
  });
}

/** Session-local bounded cache, fetched lazily by visible avatars, not by the
 * member-list request. A broken picture must never hide names or messages. */
export class RelayAvatars {
  private cache = new Map<string, { expires: number; value: Promise<string | undefined> }>();
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly load = download) {}
  clear() { this.cache.clear(); }
  get(picture: string, relay: string, session: AbortSignal): Promise<string | undefined> {
    if (session.aborted || picture.length > MAX_BYTES * 1.4) return Promise.resolve(undefined);
    const key = `${relay}\n${picture}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (this.queue.length >= 64) return Promise.resolve(undefined);
    const value = new Promise<string | undefined>((resolve) => {
      const run = () => {
        this.active++;
        const signal = AbortSignal.any([session, AbortSignal.timeout(4000)]);
        void (signal.aborted ? Promise.resolve(undefined) : this.load(picture, relay, signal)).then(resolve, () => resolve(undefined)).finally(() => {
          this.active--; this.queue.shift()?.();
        });
      };
      if (this.active < 6) run(); else this.queue.push(run);
    });
    if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { expires: Date.now() + 60_000, value });
    return value;
  }
}
