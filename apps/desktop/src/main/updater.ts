import type { UpdateCheck } from "@capsule/shared";

/*
 * Updating in place.
 *
 * Until now Capsule could only tell you a newer version existed and hand you a
 * disk image: quit, mount, drag, replace, reopen. That is a reinstall, not an
 * update, and someone who does it once will not do it often.
 *
 * A signed and notarized build can replace itself. The release carries an
 * update feed, this asks it what is current, downloads the difference when you
 * say so, and swaps the app on quit. It never downloads on its own — a hundred
 * megabytes without being asked is not a courtesy — and it never installs
 * mid-session, because the app being replaced underneath a running turn is
 * exactly the surprise this is meant to avoid.
 */

export type UpdaterState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "unavailable";

export interface UpdaterStatus {
  state: UpdaterState;
  current: string;
  /** The version being offered, once one is. */
  latest?: string;
  /** 0–100 while downloading. */
  percent?: number;
  /** What the release says about itself. */
  notes?: string;
  /** Why the last attempt did not work. */
  detail?: string;
}

/** The subset of electron-updater this needs, so it can be tested without one. */
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
  /** False for a development run, where there is nothing to replace. */
  canInstall: boolean;
  onStatus: (status: UpdaterStatus) => void;
}

export class Updater {
  private status: UpdaterStatus;

  constructor(private readonly options: UpdaterOptions) {
    this.status = { state: "idle", current: options.currentVersion };
    const updater = options.updater;
    // Ask, then download. Never the other way round.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;

    updater.on("update-available", ((info: { version?: string; releaseNotes?: unknown }) => {
      this.set({
        state: "available",
        latest: typeof info?.version === "string" ? info.version : undefined,
        notes: typeof info?.releaseNotes === "string" ? info.releaseNotes : undefined,
      });
    }) as never);

    updater.on("update-not-available", (() => {
      this.set({ state: "idle" });
    }) as never);

    updater.on("download-progress", ((progress: { percent?: number }) => {
      this.set({
        state: "downloading",
        percent: Math.round(progress?.percent ?? 0),
      });
    }) as never);

    updater.on("update-downloaded", ((info: { version?: string }) => {
      this.set({
        state: "ready",
        latest: typeof info?.version === "string" ? info.version : this.status.latest,
        percent: 100,
      });
    }) as never);

    updater.on("error", ((error: Error) => {
      /*
       * An unreachable feed, an unsigned build, a release published without
       * update metadata: all of them arrive here, and none of them should look
       * like the app is broken. The caller falls back to pointing at the
       * download page.
       */
      this.set({ state: "unavailable", detail: error?.message ?? String(error) });
    }) as never);
  }

  current(): UpdaterStatus {
    return this.status;
  }

  /** Whether this build can replace itself at all. */
  get installable(): boolean {
    return this.options.canInstall;
  }

  async check(): Promise<UpdaterStatus> {
    if (!this.options.canInstall) {
      this.set({ state: "unavailable", detail: "This build cannot update itself." });
      return this.status;
    }
    this.set({ state: "checking" });
    try {
      await this.options.updater.checkForUpdates();
    } catch (error) {
      this.set({
        state: "unavailable",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return this.status;
  }

  async download(): Promise<UpdaterStatus> {
    if (this.status.state !== "available") return this.status;
    this.set({ state: "downloading", percent: 0 });
    try {
      await this.options.updater.downloadUpdate();
    } catch (error) {
      this.set({
        state: "unavailable",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return this.status;
  }

  /** Replaces the app and reopens it. Only ever from an explicit click. */
  install(): boolean {
    if (this.status.state !== "ready") return false;
    this.options.updater.quitAndInstall(false, true);
    return true;
  }

  private set(patch: Partial<UpdaterStatus>): void {
    this.status = { ...this.status, ...patch, current: this.options.currentVersion };
    this.options.onStatus(this.status);
  }
}

/**
 * What the sidebar should say, given both routes.
 *
 * The in-place updater is the good path. The GitHub check is what answers when
 * there is no feed to read — an older release, an unsigned build, a run from
 * source — and it can still tell someone a version exists and hand them the
 * right file.
 */
export function mergeUpdateStatus(
  updater: UpdaterStatus,
  fallback: UpdateCheck | undefined,
): UpdateCheck {
  const current = updater.current;
  switch (updater.state) {
    case "available":
      return {
        state: "update-available",
        current,
        latest: updater.latest,
        canInstall: true,
        ...(updater.notes ? { notes: updater.notes } : {}),
        ...(fallback?.url ? { url: fallback.url } : {}),
      };
    case "downloading":
      return {
        state: "downloading",
        current,
        latest: updater.latest,
        percent: updater.percent ?? 0,
      };
    case "ready":
      return { state: "ready-to-install", current, latest: updater.latest };
    case "checking":
      return fallback ?? { state: "up-to-date", current };
    case "idle":
      // The feed says there is nothing newer, which is the authoritative
      // answer even when a fallback check has not run.
      return fallback?.state === "update-available"
        ? fallback
        : { state: "up-to-date", current, ...(fallback?.latest ? { latest: fallback.latest } : {}) };
    default:
      return fallback ?? { state: "unreachable", current, detail: updater.detail };
  }
}
