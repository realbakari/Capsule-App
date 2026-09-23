import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayAvatars, avatarUrl, publicAvatarAddress, rasterData } from "./avatars.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=", "base64");
const stops: (() => Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); });
async function server() {
  const requests: { url: string; headers: Record<string, unknown> }[] = [];
  const host = createServer((request, response) => {
    requests.push({ url: request.url!, headers: request.headers });
    if (request.url === "/redirect") { response.writeHead(302, { Location: "/photo" }); response.end(); }
    else if (request.url === "/private") { response.writeHead(302, { Location: "http://127.0.0.1:1/private" }); response.end(); }
    else if (request.url === "/loop") { response.writeHead(302, { Location: "/loop" }); response.end(); }
    else if (request.url === "/oversize") { response.writeHead(200, { "Content-Type": "image/png" }); response.end(Buffer.alloc(300_000)); }
    else if (request.url === "/svg") { response.writeHead(200, { "Content-Type": "image/svg+xml" }); response.end("<svg />"); }
    else if (request.url === "/slow") { /* wait for cancellation */ }
    else { response.writeHead(200, { "Content-Type": "image/png" }); response.end(png); }
  });
  host.listen(0, "127.0.0.1"); await once(host, "listening");
  stops.push(() => new Promise((resolve) => { host.closeAllConnections(); host.close(() => resolve()); }));
  return { url: `http://127.0.0.1:${(host.address() as { port: number }).port}`, requests };
}

describe("relay profile images", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.1.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::"])("blocks untrusted private/reserved address %s", (address) => {
    expect(publicAvatarAddress(address)).toBe(false);
  });
  it("accepts public CDN addresses and relative relay paths, not local files or credentials", () => {
    expect(publicAvatarAddress("1.1.1.1")).toBe(true);
    expect(publicAvatarAddress("2606:4700:4700::1111")).toBe(true);
    expect(avatarUrl("/photo", "https://relay.example").href).toBe("https://relay.example/photo");
    for (const value of ["file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.test/p", "https://127.0.0.1/p", "http://cdn.example/p"]) {
      expect(() => avatarUrl(value, "https://relay.example")).toThrow();
    }
  });
  it("returns only bounded raster bytes with matching signatures", () => {
    expect(rasterData(png, "image/png")).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(rasterData(Buffer.from("<svg />"), "image/png")).toBeUndefined();
    expect(rasterData(png, "text/html")).toBeUndefined();
    expect(rasterData(Buffer.alloc(300_000), "image/png")).toBeUndefined();
  });
  it("loads actual profile bytes without credentials, follows safe redirects and caches", async () => {
    const host = await server(); const avatars = new RelayAvatars(); const signal = new AbortController().signal;
    const image = await avatars.get("/redirect", host.url, signal);
    expect(image).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(await avatars.get("/redirect", host.url, signal)).toBe(image);
    expect(host.requests.map((item) => item.url)).toEqual(["/redirect", "/photo"]);
    expect(host.requests[0]!.headers).not.toHaveProperty("authorization");
    expect(host.requests[0]!.headers).not.toHaveProperty("cookie");
    expect(host.requests[0]!.headers).not.toHaveProperty("referer");
    for (const picture of ["/oversize", "/svg", "/private", "/loop", "file:///tmp/private"]) expect(await avatars.get(picture, host.url, signal)).toBeUndefined();
    expect(host.requests.filter((item) => item.url === "/loop")).toHaveLength(3);
  });
  it("cancels in-flight pictures on disconnect", async () => {
    const host = await server(); const controller = new AbortController(); const avatars = new RelayAvatars();
    const pending = avatars.get("/slow", host.url, controller.signal);
    await vi.waitFor(() => expect(host.requests).toHaveLength(1)); controller.abort();
    expect(await pending).toBeUndefined();
  });
  it("deduplicates concurrent loads and bounds concurrency", async () => {
    const done: (() => void)[] = [];
    const load = vi.fn(async () => { await new Promise<void>((resolve) => done.push(resolve)); return "data:image/png;base64,fixture"; });
    const avatars = new RelayAvatars(load); const signal = new AbortController().signal;
    const first = avatars.get("/0", "https://relay.example", signal);
    expect(avatars.get("/0", "https://relay.example", signal)).toBe(first);
    const others = Array.from({ length: 9 }, (_, index) => avatars.get(`/${index + 1}`, "https://relay.example", signal));
    expect(load).toHaveBeenCalledTimes(6);
    for (let index = 0; index < 10; index++) { done[index]!(); await new Promise((resolve) => setTimeout(resolve, 0)); }
    await Promise.all([first, ...others]); expect(load).toHaveBeenCalledTimes(10);
  });
});
