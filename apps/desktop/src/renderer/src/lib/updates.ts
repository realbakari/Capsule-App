import { useEffect, useRef, useState } from "react";
import type { UpdateCheck } from "@capsule/shared";
import { useWorkspace } from "./workspace";
import { formatUserError } from "./errors";
import type { ToastInput } from "./toasts";

/** Capsule's own changelog: what each release changed, in the product's words. */
export const RELEASE_NOTES_URL = "https://cpcl.dev/updates";

/** The notes for the version on offer when Capsule knows its page, else the changelog. */
export function releaseNotesUrl(status?: UpdateCheck): string {
  return status?.url ?? RELEASE_NOTES_URL;
}

/** An update that was installed but did not apply, while nothing newer is under way. */
function failedInstall(status?: UpdateCheck): string | undefined {
  return status?.notApplied && ["unknown", "up-to-date", "unreachable", "no-releases"].includes(status.state) ? status.notApplied : undefined;
}

export type UpdateAction = "check" | "download" | "install";

/** What one action the user started ended in, read back from the canonical status. */
export interface UpdateOutcome {
  action: UpdateAction;
  status?: UpdateCheck;
  error?: string;
}

export function updateActionLabel(status?: UpdateCheck): string {
  if (status?.development) return "Check for updates";
  if (failedInstall(status)) return "Retry update";
  switch (status?.state) {
    case "checking": return "Checking for updates…";
    case "downloading": return `Downloading update · ${status.percent ?? 0}%`;
    case "installing": return "Preparing restart…";
    case "ready-to-install": return status.detail ? "Retry restart & install" : "Restart & install";
    case "update-available": return status.canInstall ? status.detail ? "Retry download" : "Download update" : "Check again";
    case "unreachable": return "Retry update check";
    default: return "Check for updates";
  }
}

export type UpdateIcon = "idle" | "checking" | "available" | "downloading" | "ready" | "installing";

/** The sidebar's one update control: its glyph, what a press does, and its tooltip. */
export interface UpdateButtonView {
  icon: UpdateIcon;
  /** Absent while nothing can be started: checking, downloading, restarting, or a build that cannot update. */
  action?: UpdateAction;
  tooltip: string;
  /** Why updates are unavailable, under the tooltip's title. */
  detail?: string;
  percent?: number;
}

/**
 * A failed background check is not news; the control returns to idle and a
 * check the user starts reports its own failure. A failed download or
 * restart keeps its offer, so the control says what to retry.
 */
export function updateButtonView(status: UpdateCheck | undefined, working = false): UpdateButtonView {
  if (status?.development) return { icon: "idle", tooltip: "Updates unavailable", detail: status.detail ?? "This build cannot update itself." };
  const version = status?.latest;
  switch (status?.state) {
    case "downloading": {
      const percent = status.percent ?? 0;
      return { icon: "downloading", percent, tooltip: `Downloading update (${Math.floor(percent)}%)` };
    }
    case "installing": return { icon: "installing", tooltip: "Preparing restart…" };
    case "ready-to-install": return working ? { icon: "installing", tooltip: "Preparing restart…" } : {
      icon: "ready", action: "install",
      tooltip: status.retry === "install" && status.detail
        ? `Restart failed for ${version ?? "the update"}. Click to retry.`
        : `Update ${version ?? "ready"} downloaded. Click to restart and install.`,
    };
    case "update-available": if (status.canInstall) return working ? { icon: "checking", tooltip: "Starting download…" } : {
      icon: "available", action: "download",
      tooltip: status.retry === "download" && status.detail
        ? `Download failed for ${version ?? "the update"}. Click to retry.`
        : `Update ${version ?? "available"} ready to download`,
    };
  }
  if (working || status?.state === "checking") return { icon: "checking", tooltip: "Checking for updates…" };
  const failed = failedInstall(status);
  if (failed) return { icon: "available", action: "check", tooltip: `Capsule ${failed} didn’t install. Click to try again.` };
  return { icon: "idle", action: "check", tooltip: "Check for updates" };
}

const FAILED: Record<UpdateAction, string> = {
  check: "Could not check for updates",
  download: "Could not download update",
  install: "Could not install update",
};

/** Only an action the user started reports back; background checks stay quiet. */
export function updateOutcomeToast({ action, status, error }: UpdateOutcome): ToastInput | undefined {
  const detail = error ?? (status?.retry === action ? status.detail : undefined);
  if (detail) return { key: "update", tone: "error", title: FAILED[action], detail };
  if (action === "check" && status?.state === "up-to-date") {
    return { key: "update", title: "You’re up to date", detail: `Capsule ${status.current} is the newest version.` };
  }
  return undefined;
}

export function updateDownloadedToast(status?: UpdateCheck): ToastInput {
  const latest = status?.latest;
  return {
    key: "update", tone: "success", title: latest ? `Capsule ${latest} downloaded` : "Update downloaded",
    detail: "Restart from the update button to install it.",
    action: { label: "Release notes", run: () => { window.open(releaseNotesUrl(status), "_blank", "noopener"); } },
  };
}

/** Told once per launch: the restart to install came back on the old version. */
export function updateNotAppliedToast(status: UpdateCheck, retry: () => void): ToastInput {
  return {
    key: "update", tone: "error", title: `Capsule ${status.notApplied} didn’t install`,
    detail: `Capsule restarted on ${status.current}. Try the update again; it downloads before it asks to restart.`,
    timeoutMs: 15_000,
    action: { label: "Retry", run: retry },
  };
}

/** Subscribe first, then read; an older initial snapshot cannot undo progress. */
export function useUpdates(onSettled?: (outcome: UpdateOutcome) => void) {
  const { api, setConfirm } = useWorkspace();
  const [status, setStatus] = useState<UpdateCheck>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const action = useRef(false);
  const revision = useRef(0);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  /* An API without the update status channel has nothing to read, so nothing to offer. */
  const available = typeof api.updateStatus === "function" && typeof api.on === "function";
  useEffect(() => {
    if (!available) return;
    let disposed = false;
    const refresh = () => {
      const version = ++revision.current;
      void api.updateStatus().then((next) => {
        if (!disposed && version === revision.current) setStatus(next as UpdateCheck);
      }, (failure) => {
        if (!disposed && version === revision.current) setError(formatUserError(failure));
      });
    };
    const off = api.on("state", (payload) => {
      if ((payload as { command?: string }).command === "update-status") refresh();
    });
    refresh();
    return () => { disposed = true; off(); };
  }, [api, available]);

  async function perform(kind: UpdateAction): Promise<UpdateOutcome | undefined> {
    if (action.current) return undefined;
    action.current = true; setWorking(true); setError(undefined);
    ++revision.current;
    let outcome: UpdateOutcome = { action: kind };
    try {
      if (kind === "install") await api.installUpdate();
      else if (kind === "download") await api.downloadUpdate();
      else await api.checkForUpdates();
      // Read the canonical state, not an older check response racing progress.
      const version = ++revision.current;
      const next = await api.updateStatus() as UpdateCheck;
      if (version === revision.current) setStatus(next);
      outcome = { action: kind, status: next };
    } catch (failure) {
      const message = formatUserError(failure);
      setError(message);
      outcome = { action: kind, error: message };
    } finally { action.current = false; setWorking(false); }
    settled.current?.(outcome);
    return outcome;
  }
  /* A failed install starts over: check, then fetch the update again, then the usual restart offer. */
  async function retryInstall() {
    const checked = await perform("check");
    if (checked?.status?.state === "update-available" && checked.status.canInstall) await perform("download");
  }
  function run() {
    if (busy || !available) return;
    if (status?.state === "ready-to-install") {
      setConfirm({
        title: `Install Capsule ${status.latest ?? "update"} and restart?`,
        detail: "Save open files first. Active turns, checks and terminals must finish before Capsule restarts.",
        confirmLabel: "Restart & install",
        onConfirm: () => perform("install"),
      });
    } else if (failedInstall(status)) void retryInstall();
    else void perform(status?.state === "update-available" && status.canInstall ? "download" : "check");
  }
  const busy = working || Boolean(status?.development) || ["checking", "downloading", "installing"].includes(status?.state ?? "");
  return { available, status, error, run, retryInstall: () => { if (!busy && available) void retryInstall(); }, working, busy, label: working ? "Updating…" : updateActionLabel(status) };
}
