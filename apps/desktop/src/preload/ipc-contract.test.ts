import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IPC_CHANNELS, IPC_EVENTS } from "@capsule/shared";

/*
 * The preload is the whole contract between the renderer and the main process,
 * and it is written by hand. A channel that exists in IPC_CHANNELS and was
 * never wired through here fails at the moment someone clicks the thing —
 * there is no build step that would notice.
 */
const preload = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "index.ts"),
  "utf8",
);
const main = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../main/index.ts"),
  "utf8",
);

/** Channels the renderer is deliberately not given. */
const RENDERER_EXEMPT = new Set<string>([]);

describe("ipc contract", () => {
  it("exposes every channel to the renderer", () => {
    const missing = Object.keys(IPC_CHANNELS).filter(
      (name) => !RENDERER_EXEMPT.has(name) && !preload.includes(`IPC_CHANNELS.${name}`),
    );
    expect(missing).toEqual([]);
  });

  it("has a main-process handler for every channel", () => {
    const missing = Object.keys(IPC_CHANNELS).filter((name) => !main.includes(`IPC_CHANNELS.${name}`));
    expect(missing).toEqual([]);
  });

  it("forwards every event the main process sends", () => {
    // The preload subscribes by key rather than by name, so the guarantee here
    // is the other direction: an event nothing sends is dead weight.
    const unsent = Object.keys(IPC_EVENTS).filter((name) => !main.includes(`IPC_EVENTS.${name}`));
    expect(unsent).toEqual([]);
  });
});
