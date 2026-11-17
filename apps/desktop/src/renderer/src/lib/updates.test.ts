import { describe, expect, it } from "vitest";
import type { UpdateCheck } from "@capsule/shared";
import { RELEASE_NOTES_URL, updateActionLabel, updateButtonView, updateDownloadedToast, updateOutcomeToast } from "./updates";

const current = "0.13.0";
const status = (patch: Partial<UpdateCheck>): UpdateCheck => ({ state: "unknown", current, ...patch });

describe("updateButtonView", () => {
  it("checks from idle and says nothing else about it", () => {
    for (const state of ["unknown", "up-to-date", "no-releases"] as const) {
      expect(updateButtonView(status({ state }))).toEqual({ icon: "idle", action: "check", tooltip: "Check for updates" });
    }
    expect(updateButtonView(undefined)).toMatchObject({ icon: "idle", action: "check" });
  });

  it("keeps a failed background check quiet and offers another", () => {
    expect(updateButtonView(status({ state: "unreachable", retry: "check", detail: "Offline" })))
      .toEqual({ icon: "idle", action: "check", tooltip: "Check for updates" });
  });

  it("cannot be pressed while a check, download or restart runs", () => {
    expect(updateButtonView(status({ state: "checking" }))).toEqual({ icon: "checking", tooltip: "Checking for updates…" });
    expect(updateButtonView(status({ state: "up-to-date" }), true)).toEqual({ icon: "checking", tooltip: "Checking for updates…" });
    expect(updateButtonView(status({ state: "downloading", percent: 42.7 })))
      .toEqual({ icon: "downloading", percent: 42.7, tooltip: "Downloading update (42%)" });
    expect(updateButtonView(status({ state: "installing" }))).toEqual({ icon: "installing", tooltip: "Preparing restart…" });
    expect(updateButtonView(status({ state: "ready-to-install", latest: "0.14.0" }), true)).toEqual({ icon: "installing", tooltip: "Preparing restart…" });
  });

  it("offers the download, then the restart, naming the version", () => {
    expect(updateButtonView(status({ state: "update-available", latest: "0.14.0", canInstall: true })))
      .toEqual({ icon: "available", action: "download", tooltip: "Update 0.14.0 ready to download" });
    expect(updateButtonView(status({ state: "ready-to-install", latest: "0.14.0" })))
      .toEqual({ icon: "ready", action: "install", tooltip: "Update 0.14.0 downloaded. Click to restart and install." });
  });

  it("says what to retry after a failed download or restart", () => {
    expect(updateButtonView(status({ state: "update-available", latest: "0.14.0", canInstall: true, retry: "download", detail: "Network" })).tooltip)
      .toBe("Download failed for 0.14.0. Click to retry.");
    expect(updateButtonView(status({ state: "ready-to-install", latest: "0.14.0", retry: "install", detail: "Close terminals" })).tooltip)
      .toBe("Restart failed for 0.14.0. Click to retry.");
  });

  it("disables a build that cannot update and explains why", () => {
    const view = updateButtonView(status({ state: "update-available", latest: "0.14.0", development: true, detail: "This is a development build." }));
    expect(view).toEqual({ icon: "idle", tooltip: "Updates unavailable", detail: "This is a development build." });
    expect(updateActionLabel(status({ state: "unreachable", development: true }))).toBe("Check for updates");
  });
});

describe("update toasts", () => {
  it("answers a check the user asked for", () => {
    expect(updateOutcomeToast({ action: "check", status: status({ state: "up-to-date" }) }))
      .toMatchObject({ title: "You’re up to date", detail: "Capsule 0.13.0 is the newest version." });
    expect(updateOutcomeToast({ action: "check", status: status({ state: "unreachable", retry: "check", detail: "Offline" }) }))
      .toMatchObject({ tone: "error", title: "Could not check for updates", detail: "Offline" });
    expect(updateOutcomeToast({ action: "check", status: status({ state: "downloading", percent: 3 }) })).toBeUndefined();
  });

  it("reports a failed download or restart, and an IPC failure", () => {
    expect(updateOutcomeToast({ action: "download", status: status({ state: "update-available", retry: "download", detail: "Network" }) }))
      .toMatchObject({ tone: "error", title: "Could not download update", detail: "Network" });
    expect(updateOutcomeToast({ action: "install", status: status({ state: "ready-to-install", retry: "install", detail: "Close terminals" }) }))
      .toMatchObject({ tone: "error", title: "Could not install update", detail: "Close terminals" });
    expect(updateOutcomeToast({ action: "download", error: "Denied" })).toMatchObject({ title: "Could not download update", detail: "Denied" });
  });

  it("does not repeat an older failure for a different action", () => {
    expect(updateOutcomeToast({ action: "check", status: status({ state: "ready-to-install", retry: "install", detail: "Close terminals" }) })).toBeUndefined();
  });

  it("points a finished download at the changelog", () => {
    const toast = updateDownloadedToast("0.14.0");
    expect(toast).toMatchObject({ tone: "success", title: "Capsule 0.14.0 downloaded", detail: "Restart from the update button to install it." });
    expect(toast.action?.label).toBe("Release notes");
    expect(RELEASE_NOTES_URL).toBe("https://cpcl.dev/updates");
  });
});
