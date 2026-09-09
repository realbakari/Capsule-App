import { BrowserWindow, type Event } from "electron";
import { randomUUID } from "node:crypto";
import type { BackgroundBrowserCommand, BackgroundBrowserView } from "@capsule/shared";
import { boundedBrowserOperation, browserScreenshot, readNavigableUrl, type BrowserTarget } from "./browser-tools";
import { secureBrowserSession } from "./browser-security";
import { observeBrowser } from "./browser-diagnostics";

const MAX_PAGES = 4;
const LIFETIME_MS = 30 * 60_000;
interface Page {
  window: BrowserWindow;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  agentAllowed: boolean;
  harnessId?: string;
  remoteShared: boolean;
  error?: string;
  epoch: number;
  cached?: BackgroundBrowserView;
  capturing?: Promise<BackgroundBrowserView>;
}

/** Explicit, temporary pages. No invisible process restoration or profile import. */
export class BackgroundBrowsers {
  private readonly pages = new Map<string, Page>();

  has(owner: string): boolean { return this.pages.has(owner); }
  get size(): number { return this.pages.size; }

  async control(owner: string, command: BackgroundBrowserCommand, harnessId?: string): Promise<BackgroundBrowserView> {
    if (command.kind === "close") { this.close(owner); return { exists: false }; }
    let page = this.pages.get(owner);
    if (command.kind === "start") {
      if (page) throw new Error("This thread already has a background page. Close it before starting another.");
      if (this.pages.size >= MAX_PAGES) throw new Error("At most four background pages can run. Close one first.");
      const { url, detail } = readNavigableUrl(command.url);
      if (!url) throw new Error(detail);
      const window = new BrowserWindow({ show: false, width: 1024, height: 768, webPreferences: {
        partition: `capsule-background:${randomUUID()}`, sandbox: true, contextIsolation: true,
        nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
        webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false, disableDialogs: true,
      } });
      const partition = window.webContents.session;
      secureBrowserSession(partition);
      observeBrowser(window.webContents);
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-prevent-unload", (event) => event.preventDefault());
      const guardNavigation = (event: Event, destination: string) => { if (!readNavigableUrl(destination).url) event.preventDefault(); };
      window.webContents.on("will-navigate", guardNavigation);
      window.webContents.on("will-redirect", guardNavigation);
      window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        // WebSocket subresources carry live reload and app updates. Top-level
        // navigation still goes through the separate HTTP(S)-only guards.
        callback({ cancel: !/^(https?:|wss?:|data:|blob:)/.test(details.url) });
      });
      const entry: Page = { window, expiresAt: Date.now() + LIFETIME_MS, agentAllowed: false, remoteShared: false, epoch: 0,
        timer: setTimeout(() => { if (this.pages.get(owner) === entry) this.close(owner); }, LIFETIME_MS) };
      entry.timer.unref();
      window.on("closed", () => {
        clearTimeout(entry.timer);
        if (this.pages.get(owner) === entry) this.pages.delete(owner);
        // A closed hidden window must not leave a service worker or its profile
        // networking in the background. This partition belongs only to this page.
        partition.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }));
        void Promise.all([partition.closeAllConnections(), partition.clearStorageData(), partition.clearCache()])
          .catch(() => { /* App shutdown may already have disposed Chromium. */ });
      });
      window.webContents.on("did-start-navigation", (_event, _url, inPlace, main) => {
        if (main && !inPlace) { entry.epoch++; entry.cached = undefined; entry.error = undefined; }
      });
      window.webContents.on("render-process-gone", () => { entry.error = "The page process stopped. Close this page and start it again."; entry.cached = undefined; entry.epoch++; });
      this.pages.set(owner, entry);
      page = entry;
      try { await boundedBrowserOperation(window.loadURL(url)); }
      catch (failure) {
        if (!window.isDestroyed()) window.webContents.stop();
        entry.error = failure instanceof Error ? failure.message : String(failure);
      }
    } else {
      if (!page || page.window.isDestroyed()) throw new Error("No background page is running for this thread.");
      if (command.kind === "agent") {
        if (typeof command.allowed !== "boolean") throw new Error("Invalid agent grant.");
        if (command.allowed && !harnessId) throw new Error("Start a direct agent in this thread before allowing background control.");
        page.agentAllowed = command.allowed; page.harnessId = harnessId;
      } else if (command.kind === "share") {
        if (typeof command.allowed !== "boolean") throw new Error("Invalid remote sharing grant.");
        page.remoteShared = command.allowed;
      } else throw new Error("Unknown background browser operation.");
      page.epoch++; page.cached = undefined;
    }
    return this.inspect(owner, false);
  }

  target(owner: string, harnessId: string): BrowserTarget | undefined {
    const page = this.pages.get(owner);
    if (!page) return undefined;
    const check = () => {
      if (this.pages.get(owner) !== page || page.window.isDestroyed() || !page.agentAllowed || page.harnessId !== harnessId) {
        throw new Error("Background page access is off for this agent. Enable it in this thread's Browser panel.");
      }
    };
    return { check, contents: () => { check(); return page.window.webContents; } };
  }

  /** Shared reads cannot create pages, grant access, navigate, or expose private previews. */
  async inspect(owner: string, remote: boolean): Promise<BackgroundBrowserView> {
    const page = this.pages.get(owner);
    if (!page || page.window.isDestroyed()) return { exists: false };
    if (remote && !page.remoteShared) return { exists: true, remoteShared: false };
    if (page.cached && Date.now() - (page.cached.capturedAt ?? 0) < 1000) return page.cached;
    if (page.capturing) return page.capturing.then(() => this.inspect(owner, remote));
    const epoch = page.epoch;
    const capture = (async (): Promise<BackgroundBrowserView> => {
      const contents = page.window.webContents;
      const result: BackgroundBrowserView = { exists: true, agentAllowed: page.agentAllowed, remoteShared: page.remoteShared,
        expiresAt: page.expiresAt, url: contents.getURL().slice(0, 2048), error: page.error, capturedAt: Date.now() };
      if (!page.error && !contents.isLoading()) {
        try {
          const screenshot = await browserScreenshot({ contents: () => contents });
          if (screenshot.ok && screenshot.image) result.image = `data:image/jpeg;base64,${screenshot.image.data}`;
          else result.error = screenshot.detail;
        } catch (failure) { result.error = failure instanceof Error ? failure.message : String(failure); }
      }
      if (this.pages.get(owner) !== page || epoch !== page.epoch || (remote && !page.remoteShared)) {
        return { exists: this.pages.has(owner), remoteShared: false };
      }
      page.cached = result;
      return result;
    })();
    page.capturing = capture;
    try { return await capture; }
    finally { if (page.capturing === capture) page.capturing = undefined; }
  }

  close(owner: string): void {
    const page = this.pages.get(owner);
    if (!page) return;
    this.pages.delete(owner); clearTimeout(page.timer); page.epoch++;
    if (!page.window.isDestroyed()) page.window.destroy();
  }
  revokeAgent(owner: string): void {
    const page = this.pages.get(owner);
    if (page) { page.agentAllowed = false; page.harnessId = undefined; page.epoch++; page.cached = undefined; }
  }
  closeAll(): void { for (const owner of this.pages.keys()) this.close(owner); }
}
