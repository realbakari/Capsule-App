import type { BrowserDeviceId } from "@capsule/shared";

/** A palette request for the Browser page, kept until a mounted page takes it. */
export type BrowserCommand = { type: "inspect" } | { type: "device"; device: BrowserDeviceId };

export const BROWSER_COMMAND_EVENT = "capsule:browser-command";
let pending: BrowserCommand | undefined;

export function requestBrowserCommand(command: BrowserCommand): void {
  pending = command;
  window.dispatchEvent(new CustomEvent(BROWSER_COMMAND_EVENT));
}

export function takeBrowserCommand(): BrowserCommand | undefined {
  const command = pending;
  pending = undefined;
  return command;
}
