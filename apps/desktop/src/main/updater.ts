import type { UpdateCheck } from "@capsule/shared";

export type UpdaterState = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "unavailable";
export interface UpdaterStatus {
  state: UpdaterState;
  current: string;
  latest?: string;
  percent?: number;
  notes?: string;
  detail?: string;
  retry?: "check" | "download" | "install";
  checked?: boolean;
}

/** The library owns downloads and signature verification; this owns UI state. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, handler: (...args: never[]) => void): unknown;
}
export interface UpdaterOptions {
  updater: AutoUpdaterLike;
  currentVersion: string;
  canInstall: boolean;
  onStatus: (status: UpdaterStatus) => void;
  autoDownload?: () => boolean;
  /** Check active work and flush persistence before native code closes windows. */
  prepareInstall?: () => Promise<void>;
  /** Synchronous admission, held until native quit or a cancelled attempt. */
  reserveInstall?: () => () => void;
  /** macOS local staging, without registering a future automatic quit. */
  stageInstall?: (signal: AbortSignal) => Promise<void>;
}

export class Updater {
  private status: UpdaterStatus;
  private checking?: Promise<UpdaterStatus>;
  private installation?: { controller: AbortController; release?: () => void };
  constructor(private readonly options: UpdaterOptions) {
    this.status = { state: "idle", current: options.currentVersion, checked: false };
    const updater = options.updater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on("update-available", ((info: { version?: string; releaseNotes?: unknown }) => {
      if (["downloading", "ready", "installing"].includes(this.status.state)) return;
      this.set({ state: "available", latest: info.version, detail: undefined, retry: undefined, percent: undefined,
        notes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined });
      if (this.options.canInstall && this.options.autoDownload?.()) void this.download();
    }) as never);
    updater.on("update-not-available", (() => {
      if (["downloading", "ready", "installing"].includes(this.status.state)) return;
      this.set({ state: "idle", checked: true, latest: undefined, notes: undefined, detail: undefined, retry: undefined, percent: undefined });
    }) as never);
    updater.on("download-progress", ((progress: { percent?: number }) => {
      if (this.status.state === "ready" || this.status.state === "installing") return;
      this.set({ state: "downloading", percent: Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, Math.round(progress.percent!))) : 0 });
    }) as never);
    updater.on("update-downloaded", ((info: { version?: string }) => {
      if (this.status.state === "installing") return;
      this.set({ state: "ready", latest: info.version ?? this.status.latest, percent: 100, detail: undefined, retry: undefined });
    }) as never);
    updater.on("error", ((error: Error) => this.fail(error)) as never);
  }

  current(): UpdaterStatus { return this.status; }
  get installable(): boolean { return this.options.canInstall; }

  check(): Promise<UpdaterStatus> {
    if (!this.options.canInstall) {
      this.set({ state: "unavailable", detail: "Development builds cannot update in place.", retry: undefined });
      return Promise.resolve(this.status);
    }
    if (["downloading", "ready", "installing"].includes(this.status.state)) return Promise.resolve(this.status);
    if (this.checking) return this.checking;
    this.set({ state: "checking", detail: undefined, retry: undefined });
    const operation = Promise.resolve().then(() => this.options.updater.checkForUpdates())
      .catch((error) => this.fail(error)).then(() => this.status);
    this.checking = operation;
    void operation.finally(() => { if (this.checking === operation) this.checking = undefined; });
    return operation;
  }

  async download(): Promise<UpdaterStatus> {
    if (!this.options.canInstall || this.status.state !== "available") return this.status;
    this.set({ state: "downloading", percent: 0, detail: undefined, retry: undefined });
    try { await this.options.updater.downloadUpdate(); }
    catch (error) { this.fail(error, "download"); }
    return this.status;
  }

  async install(): Promise<boolean> {
    if (!this.options.canInstall || this.status.state !== "ready") return false;
    const attempt = { controller: new AbortController(), release: undefined as (() => void) | undefined };
    this.installation = attempt;
    this.set({ state: "installing", detail: undefined, retry: undefined });
    try {
      attempt.release = this.options.reserveInstall?.();
      await this.options.prepareInstall?.();
      // Native updater errors can arrive while persistence is being flushed.
      // A failed attempt must stay recoverable instead of closing the app.
      if (this.installation !== attempt) return false;
      await this.options.stageInstall?.(attempt.controller.signal);
      if (this.installation !== attempt) return false;
      this.options.updater.quitAndInstall(false, true);
      return true;
    } catch (error) {
      // A native error can end this attempt while its preparation still awaits.
      // Its late rejection must not release or overwrite a newer retry.
      if (this.installation === attempt) this.fail(error, "install");
      return false;
    }
  }

  private fail(error: unknown, operation?: "check" | "download" | "install"): void {
    if (this.installation) {
      const attempt = this.installation;
      this.installation = undefined;
      attempt.controller.abort();
      attempt.release?.();
    }
    // Duplicate library error events must not discard the offer or downloaded file.
    const hasDownloadedUpdate = this.status.state === "ready" || this.status.state === "installing";
    const retry = hasDownloadedUpdate ? "install"
      : this.status.retry ?? operation ?? (this.status.state === "downloading" ? "download" : "check");
    this.set({
      state: retry === "download" ? "available" : retry === "install" ? "ready" : "unavailable",
      retry,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  private set(patch: Partial<UpdaterStatus>): void {
    this.status = { ...this.status, ...patch, current: this.options.currentVersion };
    this.options.onStatus(this.status);
  }
}

/** One answer for action replies, startup snapshots and broadcasts. */
export function mergeUpdateStatus(updater: UpdaterStatus, fallback?: UpdateCheck): UpdateCheck {
  const common = { current: updater.current, latest: updater.latest ?? fallback?.latest, detail: updater.detail, retry: updater.retry,
    notes: updater.notes, ...(fallback?.url ? { url: fallback.url, download: fallback.download } : {}) };
  switch (updater.state) {
    case "available": return { ...common, state: "update-available", canInstall: true };
    case "downloading": return { ...common, state: "downloading", percent: updater.percent ?? 0 };
    case "ready": return { ...common, state: "ready-to-install" };
    case "installing": return { ...common, state: "installing" };
    case "checking": return { ...common, state: "checking" };
    case "idle": return { current: updater.current, state: updater.checked === false ? "unknown" : "up-to-date" };
    default: return updater.retry ? { ...common, state: "unreachable" }
      : { ...(fallback ?? { state: "unreachable", current: updater.current }), detail: updater.detail ?? fallback?.detail };
  }
}
