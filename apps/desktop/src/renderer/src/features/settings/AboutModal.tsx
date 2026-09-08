import { useState } from "react";
import { useUpdates } from "../../lib/updates";
import { XIcon } from "../shell/icons";
import { UpdateControl } from "./UpdateControl";

function AboutContents() {
  const update = useUpdates();
  const [copyState, setCopyState] = useState("Copy version info");
  const version = update.status?.current;
  async function copy() {
    try {
      await navigator.clipboard.writeText(`Capsule: ${version ?? "Unknown"}\nGateway protocol: 4\nOS: ${navigator.userAgent}`);
      setCopyState("Copied");
    } catch { setCopyState("Could not copy — try again"); }
  }
  return <>
    <div className="about-icon-squircle"><img src="./icon.png" alt="Capsule" className="about-app-icon" /></div>
    <h2 className="about-app-name">Capsule</h2>
    <div className="about-app-version">{version ? `Version ${version}` : update.error ? "Version unavailable" : "Reading version…"}</div>
    <div className="about-app-copyright">Copyright © 2026 Capsule</div>
    <div className="about-modal-actions">
      <button type="button" className="about-copy-btn" disabled={!version} onClick={() => void copy()}>{copyState}</button>
      <UpdateControl update={update} />
    </div>
  </>;
}

export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <div className="about-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="About Capsule">
    <div className="about-modal-card" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="about-modal-close" onClick={onClose} aria-label="Close About"><XIcon size={18} /></button>
      <AboutContents />
    </div>
  </div>;
}

export function AboutCard() {
  return <div className="about-embed-card"><AboutContents /></div>;
}
