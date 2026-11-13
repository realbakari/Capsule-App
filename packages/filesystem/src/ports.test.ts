import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { listListeningPorts, parseLsofPorts, parsePageTitle, probeLocalServer } from "./ports.js";

// Shaped exactly as lsof -F prints it, including the repeated descriptor.
const sample = ["p4662", "cnode", "f11", "n*:5173", "f14", "n*:5173", "f21", "n127.0.0.1:18789"].join("\n");

describe("parseLsofPorts", () => {
  it("reads the pid, command and every port a process listens on", () => {
    expect(parseLsofPorts(sample)).toEqual([
      { port: 5173, command: "node", pid: 4662 },
      { port: 18789, command: "node", pid: 4662 },
    ]);
  });

  it("collapses a port held on several descriptors", () => {
    // f11 and f14 are the same port; listing it twice would be noise.
    expect(parseLsofPorts(sample).filter((s) => s.port === 5173)).toHaveLength(1);
  });

  it("keeps each process with its own command", () => {
    const output = ["p1", "cvite", "n*:5173", "p2", "cElectron", "n*:57253"].join("\n");
    expect(parseLsofPorts(output).map((s) => s.command)).toEqual(["vite", "Electron"]);
  });

  it("accepts the IPv6 loopback", () => {
    expect(parseLsofPorts(["p1", "cnode", "n[::1]:3000"].join("\n"))[0]?.port).toBe(3000);
  });

  it("drops addresses bound to a routable interface", () => {
    // Something listening only on the LAN address is not reachable at
    // localhost, so offering it would open a page that never loads.
    expect(parseLsofPorts(["p1", "cnode", "n192.168.1.10:5173"].join("\n"))).toEqual([]);
  });

  it("hides system daemons nobody wants to open", () => {
    const output = ["p661", "crapportd", "n*:51478", "p700", "cnode", "n*:3000"].join("\n");
    expect(parseLsofPorts(output).map((s) => s.command)).toEqual(["node"]);
  });

  it("ignores malformed and out-of-range ports", () => {
    const output = ["p1", "cnode", "n*:notaport", "n*:99999", "n*:0", "n*:8080"].join("\n");
    expect(parseLsofPorts(output).map((s) => s.port)).toEqual([8080]);
  });

  it("sorts by port so the list does not reshuffle between polls", () => {
    const output = ["p1", "cnode", "n*:9000", "n*:3000", "n*:5173"].join("\n");
    expect(parseLsofPorts(output).map((s) => s.port)).toEqual([3000, 5173, 9000]);
  });

  it("returns nothing for empty output rather than throwing", () => {
    expect(parseLsofPorts("")).toEqual([]);
  });

});

describe("listListeningPorts", () => {
  const originalPath = process.env.PATH;
  const dirs: string[] = [];
  afterEach(() => {
    process.env.PATH = originalPath;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** Puts a stand-in lsof first on PATH: it prints `output` after `delay` seconds. */
  function fakeLsof(output: string, delay: number): void {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-lsof-"));
    dirs.push(dir);
    const script = path.join(dir, "lsof");
    writeFileSync(path.join(dir, "output"), output);
    writeFileSync(script, `#!/bin/sh\nsleep ${delay}\ncat "${dir}/output"\n`);
    chmodSync(script, 0o755);
    process.env.PATH = `${dir}:${originalPath}`;
  }

  it("parses lsof's output exactly as the parser does", async () => {
    fakeLsof(sample, 0);
    expect(await listListeningPorts()).toEqual(parseLsofPorts(sample));
    expect(await listListeningPorts()).toEqual([
      { port: 5173, command: "node", pid: 4662 },
      { port: 18789, command: "node", pid: 4662 },
    ]);
  });

  it("keeps the event loop turning while lsof is slow", async () => {
    fakeLsof(sample, 0.5);
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 10);
    try {
      const ports = await listListeningPorts();
      expect(ports.map((entry) => entry.port)).toEqual([5173, 18789]);
    } finally {
      clearInterval(timer);
    }
    // A blocking spawn lets at most one tick through, after it returns.
    expect(ticks).toBeGreaterThan(10);
  });

  it("returns nothing when lsof is not installed", async () => {
    const empty = mkdtempSync(path.join(tmpdir(), "capsule-empty-"));
    dirs.push(empty);
    process.env.PATH = empty;
    expect(await listListeningPorts()).toEqual([]);
  });

  it("runs against the real machine without throwing", async () => {
    const servers = await listListeningPorts();
    expect(Array.isArray(servers)).toBe(true);
    for (const server of servers) {
      expect(server.port).toBeGreaterThan(0);
      expect(typeof server.command).toBe("string");
    }
  });
});

describe("parsePageTitle", () => {
  it("reads and normalizes an HTML title", () => {
    expect(parsePageTitle("<html><title> Capsule\n Preview </title></html>")).toBe(
      "Capsule Preview",
    );
  });
});

describe("probing a local server", () => {
  it("settles when a page sends its headers and then stalls", async () => {
    // Streamed SSR during a first compile: headers, a little HTML, then nothing.
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.write("<html><head><title>Stalled app</title></head>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const started = Date.now();
      const found = await probeLocalServer({ port, command: "node", pid: process.pid }, 200);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(found?.title).toBe("Stalled app");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
