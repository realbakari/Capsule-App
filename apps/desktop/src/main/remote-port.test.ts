import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { startOnRememberedPort } from "./remote-port";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function listen(port: number | undefined): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port ?? 0, "127.0.0.1", () => {
      servers.push(server);
      resolve({ port: (server.address() as { port: number }).port });
    });
  });
}

function portFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-remote-port-"));
  dirs.push(dir);
  return path.join(dir, "state", "remote-port");
}

it("keeps the same port across restarts so share links still open", async () => {
  const file = portFile();
  const first = await startOnRememberedPort(file, listen);
  expect(readFileSync(file, "utf8").trim()).toBe(String(first.port));
  servers.splice(0).forEach((server) => server.close());
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await startOnRememberedPort(file, listen);
  expect(second.port).toBe(first.port);
});

it("takes a new port and remembers it when the old one is taken", async () => {
  const file = portFile();
  const squatter = await listen(undefined);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${squatter.port}\n`);
  const handle = await startOnRememberedPort(file, listen);
  expect(handle.port).not.toBe(squatter.port);
  expect(readFileSync(file, "utf8").trim()).toBe(String(handle.port));
});

it("ignores a damaged port file", async () => {
  const file = portFile();
  const ports: Array<number | undefined> = [];
  await startOnRememberedPort(file, (port) => { ports.push(port); return listen(port); });
  writeFileSync(file, "not a port\n");
  await startOnRememberedPort(file, (port) => { ports.push(port); return listen(port); });
  expect(ports).toEqual([undefined, undefined]);
});

it("does not hide a failure that is not a busy port", async () => {
  const file = portFile();
  await expect(startOnRememberedPort(file, async () => { throw new Error("Use This computer with an HTTPS proxy"); })).rejects.toThrow("HTTPS proxy");
});
