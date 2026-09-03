import { describe, expect, it, vi } from "vitest";

import { Updater, mergeUpdateStatus, type AutoUpdaterLike, type UpdaterStatus } from "./updater";

function fakeUpdater() {
  const handlers = new Map<string, (...args: never[]) => void>();
  const api: AutoUpdaterLike & { emit: (event: string, payload?: unknown) => void } = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    on(event, handler) {
      handlers.set(event, handler);
      return this;
    },
    emit(event, payload) {
      handlers.get(event)?.(payload as never);
    },
  };
  return api;
}

describe("updating in place", () => {
  it("never downloads without being asked", () => {
    // A hundred megabytes unannounced is not a courtesy.
    const api = fakeUpdater();
    new Updater({ updater: api, currentVersion: "0.2.0", canInstall: true, onStatus: () => {} });
    expect(api.autoDownload).toBe(false);
    expect(api.autoInstallOnAppQuit).toBe(true);
  });

  it("walks offer, download, restart — each on its own click", async () => {
    const api = fakeUpdater();
    const seen: UpdaterStatus[] = [];
    const updater = new Updater({
      updater: api,
      currentVersion: "0.2.0",
      canInstall: true,
      onStatus: (status) => seen.push(status),
    });

    await updater.check();
    api.emit("update-available", { version: "0.3.0", releaseNotes: "Faster." });
    expect(updater.current()).toMatchObject({ state: "available", latest: "0.3.0" });

    // Nothing installs while only an offer has been made.
    expect(updater.install()).toBe(false);
    expect(api.quitAndInstall).not.toHaveBeenCalled();

    await updater.download();
    api.emit("download-progress", { percent: 41.6 });
    expect(updater.current()).toMatchObject({ state: "downloading", percent: 42 });

    api.emit("update-downloaded", { version: "0.3.0" });
    expect(updater.current().state).toBe("ready");
    expect(updater.install()).toBe(true);
    expect(api.quitAndInstall).toHaveBeenCalled();
    expect(seen.at(-1)?.state).toBe("ready");
  });

  it("does not try to replace a build that cannot be replaced", async () => {
    // A development run has nothing to swap, and asking only produces an error
    // to explain away.
    const api = fakeUpdater();
    const updater = new Updater({
      updater: api,
      currentVersion: "0.2.0",
      canInstall: false,
      onStatus: () => {},
    });
    expect((await updater.check()).state).toBe("unavailable");
    expect(api.checkForUpdates).not.toHaveBeenCalled();
  });

  it("treats a missing feed as something to route around, not a failure", async () => {
    const api = fakeUpdater();
    const updater = new Updater({
      updater: api,
      currentVersion: "0.2.0",
      canInstall: true,
      onStatus: () => {},
    });
    await updater.check();
    api.emit("error", new Error("Cannot find latest-mac.yml"));
    expect(updater.current()).toMatchObject({ state: "unavailable" });
  });
});

describe("what the sidebar is told", () => {
  const base: UpdaterStatus = { state: "idle", current: "0.2.0" };

  it("offers an in-place install when the feed has one", () => {
    expect(
      mergeUpdateStatus({ ...base, state: "available", latest: "0.3.0" }, undefined),
    ).toMatchObject({ state: "update-available", latest: "0.3.0", canInstall: true });
  });

  it("falls back to the download when there is no feed to read", () => {
    // Every release before 0.3.0 shipped without update metadata, so this is
    // the path a 0.2.0 install actually takes.
    const fallback = {
      state: "update-available" as const,
      current: "0.2.0",
      latest: "v0.3.0",
      url: "https://example.com/releases",
      download: { name: "Capsule-0.3.0-arm64.dmg", url: "https://example.com/dmg" },
    };
    const merged = mergeUpdateStatus({ ...base, state: "unavailable" }, fallback);
    expect(merged.state).toBe("update-available");
    // No in-place install to offer, so the sidebar hands over the file instead.
    expect(merged.canInstall).toBeUndefined();
    expect(merged.download?.name).toBe("Capsule-0.3.0-arm64.dmg");
  });

  it("reports progress while it downloads", () => {
    expect(
      mergeUpdateStatus({ ...base, state: "downloading", percent: 12, latest: "0.3.0" }, undefined),
    ).toMatchObject({ state: "downloading", percent: 12 });
  });

  it("says up to date when the feed says so", () => {
    expect(mergeUpdateStatus(base, undefined)).toMatchObject({ state: "up-to-date" });
  });
});

describe("a check that arrives while an update is already in hand", () => {
  it("does not interrupt a download in progress", async () => {
    /*
     * Every progress event told the renderer the status had changed, and the
     * renderer answered by running a full check — so a single download issued
     * a check per event, and each one reset the state to "checking". The
     * percentage was lost, the sidebar fell back to "Update available", and
     * the next click started the same download over again.
     */
    const api = fakeUpdater();
    const updater = new Updater({
      updater: api,
      currentVersion: "0.2.0",
      canInstall: true,
      onStatus: () => {},
    });
    api.emit("update-available", { version: "0.3.0" });
    api.emit("download-progress", { percent: 42 });
    expect(updater.current().state).toBe("downloading");

    const status = await updater.check();
    expect(status.state).toBe("downloading");
    expect(status.percent).toBe(42);
    expect(api.checkForUpdates).not.toHaveBeenCalled();
  });

  it("does not throw away an update already downloaded and waiting", async () => {
    const api = fakeUpdater();
    const updater = new Updater({
      updater: api,
      currentVersion: "0.2.0",
      canInstall: true,
      onStatus: () => {},
    });
    api.emit("update-available", { version: "0.3.0" });
    api.emit("update-downloaded", { version: "0.3.0" });
    expect(updater.current().state).toBe("ready");

    // Asking again must not send someone who already has the file back to
    // "download it" — that is the second download the user should never need.
    const status = await updater.check();
    expect(status.state).toBe("ready");
    expect(mergeUpdateStatus(status, undefined).state).toBe("ready-to-install");
  });
});
