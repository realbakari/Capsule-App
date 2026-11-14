import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/*
 * Share links carry the listener's address, and they outlive a restart (the
 * grants are in the database). A fresh random port on every launch broke each
 * one, so the listener asks for the port it had last time and only takes a
 * new one when something else now holds it.
 */
export async function startOnRememberedPort<T extends { port: number }>(
  file: string,
  start: (port: number | undefined) => Promise<T>,
): Promise<T> {
  const remembered = readPort(file);
  let handle: T;
  try {
    handle = await start(remembered);
  } catch (error) {
    if (remembered === undefined || (error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    handle = await start(undefined);
  }
  if (handle.port !== remembered) {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${handle.port}\n`);
    } catch {
      // Unremembered, the next launch picks a new port; this one still works.
    }
  }
  return handle;
}

function readPort(file: string): number | undefined {
  try {
    const port = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined;
  } catch {
    return undefined;
  }
}
