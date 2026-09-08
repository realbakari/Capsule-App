import { EventEmitter } from "node:events";
import { MacUpdater } from "electron-updater";
import { afterEach, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@capsule/shared";
import { NativeUpdateStager } from "./native-update-stager";
import { UpdateAdmission } from "./update-admission";
import { Updater, type AutoUpdaterLike } from "./updater";

afterEach(() => { vi.useRealTimers(); });

function fixture(timeoutMs?: number) {
  const native = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn(), quitAndInstall: vi.fn() });
  // Exercise the installed library's real deferred-quit implementation without
  // constructing a native updater, downloading anything or closing an app.
  const library = Object.assign(Object.create(MacUpdater.prototype) as AutoUpdaterLike & EventEmitter & { squirrelDownloadedUpdate: boolean }, {
    nativeUpdater: native, squirrelDownloadedUpdate: false, autoRunAppAfterInstall: true,
    _logger: { info() {}, warn() {}, debug() {} },
  });
  // These are the two event subscriptions installed by MacUpdater's constructor.
  native.on("update-downloaded", () => { library.squirrelDownloadedUpdate = true; });
  native.on("error", (error) => library.emit("error", error));
  const stager = new NativeUpdateStager(native, timeoutMs);
  const gate = new UpdateAdmission();
  const updater = new Updater({
    updater: library, currentVersion: "0.6.0", canInstall: true, onStatus() {},
    reserveInstall: () => gate.reserve(), stageInstall: (signal) => stager.stage(signal),
  });
  library.emit("update-downloaded", { version: "0.7.0" });
  return { native, library, updater, gate };
}

it("holds admission while macOS stages, then quits only after native readiness", async () => {
  const { native, updater, gate } = fixture();
  const installing = updater.install();
  await Promise.resolve();
  expect(native.checkForUpdates).toHaveBeenCalledOnce();
  expect(native.quitAndInstall).not.toHaveBeenCalled();
  await expect(gate.run(IPC_CHANNELS.terminalStart, () => "new work")).rejects.toThrow("preparing to restart");
  expect(await updater.install()).toBe(false);
  native.emit("update-downloaded");
  expect(await installing).toBe(true);
  expect(native.quitAndInstall).toHaveBeenCalledOnce();
  await expect(gate.run(IPC_CHANNELS.sendMessage, () => "new work")).rejects.toThrow("preparing to restart");
  native.emit("update-downloaded");
  expect(native.quitAndInstall).toHaveBeenCalledOnce(); // No hidden future-quit callback.
});

it("unlocks on native failure; a late download cannot quit newly started work", async () => {
  const { native, updater, gate } = fixture();
  const installing = updater.install();
  await Promise.resolve();
  native.emit("error", new Error("Native staging failed"));
  expect(await installing).toBe(false);
  expect(updater.current()).toMatchObject({ state: "ready", retry: "install", detail: "Native staging failed" });
  await expect(gate.run(IPC_CHANNELS.sendMessage, () => "allowed")).resolves.toBe("allowed");
  native.emit("update-downloaded");
  expect(native.quitAndInstall).not.toHaveBeenCalled();
  expect(await updater.install()).toBe(true);
  expect(native.checkForUpdates).toHaveBeenCalledOnce(); // Already staged; no repeated download.
  expect(native.quitAndInstall).toHaveBeenCalledOnce();
});

it("bounds a stalled native stage and permits an explicit retry without old quit callbacks", async () => {
  vi.useFakeTimers();
  const { native, updater, gate } = fixture(100);
  const installing = updater.install();
  await vi.advanceTimersByTimeAsync(101);
  expect(await installing).toBe(false);
  expect(updater.current().detail).toContain("timed out");
  await expect(gate.run(IPC_CHANNELS.writeFile, () => "allowed")).resolves.toBe("allowed");
  const retry = updater.install();
  await Promise.resolve();
  expect(native.checkForUpdates).toHaveBeenCalledOnce();
  native.emit("update-downloaded");
  expect(await retry).toBe(true);
  expect(native.quitAndInstall).toHaveBeenCalledOnce();
});
