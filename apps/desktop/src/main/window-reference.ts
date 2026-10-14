import type { BrowserWindow, WebContents } from "electron";

type EventWindow = Pick<BrowserWindow, "isDestroyed"> & {
  once(event: "closed", listener: () => void): unknown;
  webContents: Pick<WebContents, "isDestroyed" | "send">;
};

/** App services outlive the desktop window, including during quit. */
export class WindowReference<T extends EventWindow> {
  private window: T | undefined;

  get current(): T | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  set current(window: T | undefined) {
    this.window = window;
    window?.once("closed", () => {
      if (this.window === window) this.window = undefined;
    });
  }

  send(channel: string, payload: unknown): void {
    const window = this.current;
    if (!window) return;
    const contents = window.webContents;
    if (!contents.isDestroyed()) contents.send(channel, payload);
  }
}
