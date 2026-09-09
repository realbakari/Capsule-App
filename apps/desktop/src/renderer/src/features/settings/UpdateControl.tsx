import { useUpdates } from "../../lib/updates";
import type { ReactNode } from "react";

export function UpdateControl({ update, children }: { update: ReturnType<typeof useUpdates>; children?: ReactNode }) {
  const status = update.status;
  return <div className="app-update-control">
    <div className="about-modal-actions">
      {children}
      <button type="button" className="about-update-btn" disabled={update.busy} onClick={update.run}>{update.label}</button>
    </div>
    <p className="meta" role="status">{update.error ?? status?.detail ?? (status?.state === "up-to-date" ? "You’re up to date." : status?.latest ? `Version ${status.latest}` : "")}</p>
    {status?.state === "downloading" && <progress max={100} value={status.percent ?? 0} aria-label="Update download progress" />}
    {status?.latest && <a className="meta app-update-release-link" href="https://github.com/realbakari/Capsule-App/releases/latest" target="_blank" rel="noreferrer">Release notes</a>}
  </div>;
}
