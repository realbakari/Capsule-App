import { useEffect, useRef, useState } from "react";
import type { UpdateCheck } from "@capsule/shared";
import { useWorkspace } from "./workspace";
import { formatUserError } from "./errors";

export function updateActionLabel(status?: UpdateCheck): string {
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

/** Subscribe first, then read; an older initial snapshot cannot undo progress. */
export function useUpdates() {
  const { api, setConfirm } = useWorkspace();
  const [status, setStatus] = useState<UpdateCheck>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const action = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
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
  }, [api]);

  async function perform(kind: "check" | "download" | "install") {
    if (action.current) return;
    action.current = true; setWorking(true); setError(undefined);
    ++revision.current;
    try {
      if (kind === "install") await api.installUpdate();
      else if (kind === "download") await api.downloadUpdate();
      else await api.checkForUpdates();
      // Read the canonical state, not an older check response racing progress.
      const version = ++revision.current;
      const next = await api.updateStatus();
      if (version === revision.current) setStatus(next as UpdateCheck);
    } catch (failure) { setError(formatUserError(failure)); }
    finally { action.current = false; setWorking(false); }
  }
  function run() {
    if (working || ["checking", "downloading", "installing"].includes(status?.state ?? "")) return;
    if (status?.state === "ready-to-install") {
      setConfirm({ title: "Restart to install update?", detail: "Save open files first. Active turns, checks and terminals must finish before Capsule restarts.", confirmLabel: "Restart & install", onConfirm: () => perform("install") });
    } else void perform(status?.state === "update-available" && status.canInstall ? "download" : "check");
  }
  return { status, error, run, busy: working || ["checking", "downloading", "installing"].includes(status?.state ?? ""), label: working ? "Updating…" : updateActionLabel(status) };
}
