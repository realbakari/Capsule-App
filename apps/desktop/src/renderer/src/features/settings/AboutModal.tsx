import { useState } from "react";
import { XIcon } from "../shell/icons";

export function AboutModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

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

        <button type="button" className="about-copy-btn" onClick={handleCopy}>
          {copied ? "Copied!" : "Copy version info"}
        </button>
      </div>
    </div>
  );
}

export function AboutCard() {
  const [copied, setCopied] = useState(false);

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

  return (
    <div className="about-embed-card">
      <div className="about-icon-squircle">
        <img src="./icon.png" alt="Capsule" className="about-app-icon" />
      </div>

      <h2 className="about-app-name">Capsule</h2>
      <div className="about-app-version">Version 0.1.0</div>
      <div className="about-app-copyright">Copyright © 2026 Capsule</div>

      <button type="button" className="about-copy-btn" onClick={handleCopy}>
        {copied ? "Copied!" : "Copy version info"}
      </button>
    </div>
  );
}
