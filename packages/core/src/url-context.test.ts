import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchUrlContext, htmlToText, PRIVATE_URL_ERROR, urlContextTarget } from "./url-context.js";

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/page") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<html><head><title>Docs &amp; notes</title><style>p{}</style></head><body><nav>Menu</nav><h1>Hello</h1><p>First&nbsp;line</p><script>alert(1)</script><ul><li>one</li><li>two</li></ul></body></html>");
    } else if (request.url === "/to-private") {
      response.writeHead(302, { location: "http://10.0.0.1/admin" });
      response.end();
    } else if (request.url === "/to-local") {
      response.writeHead(302, { location: "/page" });
      response.end();
    } else if (request.url === "/huge") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("a".repeat(3 * 1024 * 1024));
    } else if (request.url === "/binary") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from([137, 80, 78, 71]));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("urlContextTarget", () => {
  it("refuses private, link-local and metadata addresses typed directly", () => {
    for (const address of ["http://10.0.0.1/", "http://192.168.1.20", "http://172.16.4.4", "http://169.254.169.254/latest/meta-data", "http://[fd00::1]/", "http://100.64.0.1", "http://router.local", "http://intranet/"]) {
      expect(() => urlContextTarget(address), address).toThrow(PRIVATE_URL_ERROR);
    }
  });

  it("allows loopback only when the user typed it", () => {
    expect(urlContextTarget("localhost:3000/docs")).toMatchObject({ loopback: true });
    expect(urlContextTarget("http://127.0.0.1:8080")).toMatchObject({ loopback: true });
    expect(urlContextTarget("http://[::1]:8080")).toMatchObject({ loopback: true });
    expect(urlContextTarget("example.com/a").url.href).toBe("https://example.com/a");
    expect(urlContextTarget("example.com").loopback).toBe(false);
  });

  it("refuses other schemes and embedded credentials", () => {
    expect(() => urlContextTarget("file:///etc/passwd")).toThrow("Only http and https");
    expect(() => urlContextTarget("https://user:pw@example.com")).toThrow("user name and password");
    expect(() => urlContextTarget("")).toThrow("Type a web address.");
  });
});

describe("fetchUrlContext", () => {
  it("fetches a page the user named on localhost and returns readable text", async () => {
    const page = await fetchUrlContext(`http://localhost:${port}/page`, { resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
    expect(page.title).toBe("Docs & notes");
    expect(page.text).toContain("# Hello");
    expect(page.text).toContain("First line");
    expect(page.text).toContain("- one\n- two");
    expect(page.text).not.toContain("alert");
    expect(page.text).not.toContain("Menu");
  });

  it("follows a redirect that stays on loopback", async () => {
    const page = await fetchUrlContext(`http://127.0.0.1:${port}/to-local`);
    expect(page.url).toBe(`http://127.0.0.1:${port}/page`);
  });

  it("refuses a redirect into a private network", async () => {
    await expect(fetchUrlContext(`http://127.0.0.1:${port}/to-private`)).rejects.toThrow(PRIVATE_URL_ERROR);
  });

  it("refuses a public-looking name that resolves to a private address", async () => {
    await expect(fetchUrlContext("http://docs.example.test/page", { resolve: async () => [{ address: "127.0.0.1", family: 4 }] })).rejects.toThrow(PRIVATE_URL_ERROR);
    await expect(fetchUrlContext("http://docs.example.test/page", { resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.1.1.1", family: 4 }] })).rejects.toThrow(PRIVATE_URL_ERROR);
  });

  it("stops reading at the size cap and says so", async () => {
    const page = await fetchUrlContext(`http://127.0.0.1:${port}/huge`, { maxBytes: 64 * 1024 });
    expect(page.truncated).toBe(true);
    expect(page.text.length).toBe(64 * 1024);
  });

  it("refuses a page that is not text", async () => {
    await expect(fetchUrlContext(`http://127.0.0.1:${port}/binary`)).rejects.toThrow("not a text page (image/png)");
    await expect(fetchUrlContext(`http://127.0.0.1:${port}/missing`)).rejects.toThrow("answered 404");
  });
});

describe("htmlToText", () => {
  it("prefers the main content when the page marks it", () => {
    const article = `<article><h2>Guide</h2><p>${"Useful words. ".repeat(30)}</p></article>`;
    const { text } = htmlToText(`<body><nav>Site menu</nav>${article}<footer>Copyright</footer></body>`);
    expect(text.startsWith("## Guide")).toBe(true);
    expect(text).not.toContain("Site menu");
    expect(text).not.toContain("Copyright");
  });
});
