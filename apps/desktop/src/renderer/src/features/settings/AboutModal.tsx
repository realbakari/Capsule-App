import { useState } from "react";
import type { UpdateCheck } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { XIcon } from "../shell/icons";

export function AboutModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { api } = useWorkspace();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>();

  if (!open) return null;

  async function handleCopy() {
    const info = `Capsule: 0.1.0\nProtocol: 4\nOS: ${navigator.userAgent}`;
    try {
      await navigator.clipboard.writeText(info);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  async function handleCheckUpdates() {
    setChecking(true);
    setUpdateStatus(undefined);
    try {
      const res = (await api.checkForUpdates()) as UpdateCheck;
      if (res.state === "update-available") {
        setUpdateStatus(`Version ${res.latest} available`);
        if (res.url) window.open(res.url, "_blank", "noreferrer");
      } else if (res.state === "up-to-date") {
        setUpdateStatus(`Up to date (v${res.current})`);
      } else if (res.state === "no-releases") {
        setUpdateStatus("No published releases found");
      } else {
        setUpdateStatus(`Could not check: ${res.detail ?? "unreachable"}`);
      }
    } catch (e) {
      setUpdateStatus(e instanceof Error ? e.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="about-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="about-modal-card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="about-modal-close"
          onClick={onClose}
          aria-label="Close About"
        >
          <XIcon size={18} />
        </button>

        <div className="about-icon-squircle">
          <img src="./icon.png" alt="Capsule" className="about-app-icon" />
        </div>

        <h2 className="about-app-name">Capsule</h2>
        <div className="about-app-version">Version 0.1.0</div>
        <div className="about-app-copyright">Copyright © 2026 Capsule</div>

        <div className="about-modal-actions">
          <button type="button" className="about-copy-btn" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy version info"}
          </button>
          <button
            type="button"
            className="about-update-btn"
            disabled={checking}
            onClick={() => void handleCheckUpdates()}
          >
            {checking ? "Checking…" : updateStatus ? updateStatus : "Check for updates"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AboutCard() {
  const { api } = useWorkspace();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string>();

  async function handleCopy() {
    const info = `Capsule: 0.1.0\nProtocol: 4\nOS: ${navigator.userAgent}`;
    try {
      await navigator.clipboard.writeText(info);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  async function handleCheckUpdates() {
    setChecking(true);
    setUpdateStatus(undefined);
    try {
      const res = (await api.checkForUpdates()) as UpdateCheck;
      if (res.state === "update-available") {
        setUpdateStatus(`Version ${res.latest} available`);
        if (res.url) window.open(res.url, "_blank", "noreferrer");
      } else if (res.state === "up-to-date") {
        setUpdateStatus(`Up to date (v${res.current})`);
      } else if (res.state === "no-releases") {
        setUpdateStatus("No published releases found");
      } else {
        setUpdateStatus(`Could not check: ${res.detail ?? "unreachable"}`);
      }
    } catch (e) {
      setUpdateStatus(e instanceof Error ? e.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="about-embed-card">
      <div className="about-icon-squircle">
        <img src="./icon.png" alt="Capsule" className="about-app-icon" />
      </div>

      <h2 className="about-app-name">Capsule</h2>
      <div className="about-app-version">Version 0.1.0</div>
      <div className="about-app-copyright">Copyright © 2026 Capsule</div>

      <div className="about-modal-actions">
        <button type="button" className="about-copy-btn" onClick={handleCopy}>
          {copied ? "Copied!" : "Copy version info"}
        </button>
        <button
          type="button"
          className="about-update-btn"
          disabled={checking}
          onClick={() => void handleCheckUpdates()}
        >
          {checking ? "Checking…" : updateStatus ? updateStatus : "Check for updates"}
        </button>
      </div>
    </div>
  );
}
