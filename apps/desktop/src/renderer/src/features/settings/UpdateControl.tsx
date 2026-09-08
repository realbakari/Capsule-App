import { useUpdates } from "../../lib/updates";

export function UpdateControl({ update }: { update: ReturnType<typeof useUpdates> }) {
  const status = update.status;
  return <div className="app-update-control">
    <button type="button" className="about-update-btn" disabled={update.busy} onClick={update.run}>{update.label}</button>
    <p className="meta" role="status">{update.error ?? status?.detail ?? (status?.state === "up-to-date" ? "You’re up to date." : status?.latest ? `Version ${status.latest}` : "")}</p>
    {status?.state === "downloading" && <progress max={100} value={status.percent ?? 0} aria-label="Update download progress" />}
    {status?.latest && <a className="meta" href="https://github.com/realbakari/Capsule-App/releases/latest" target="_blank" rel="noreferrer">Release notes and manual download</a>}
  </div>;
}
