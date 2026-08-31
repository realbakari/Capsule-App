import { useState } from "react";
import {
  SparkIcon,
  TerminalIcon,
  ShieldIcon,
  CopyIcon,
  CheckIcon,
  FolderIcon,
} from "../shell/icons";

export function LandingPage() {
  const [copied, setCopied] = useState<string | null>(null);

  const cloneCmd = "git clone https://github.com/realbakari/Capsule-App.git && cd Capsule-App && pnpm install && pnpm dev";

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="landing-container">
      {/* Navigation Header */}
      <header className="landing-header">
        <div className="landing-brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="6" fill="#18191b" stroke="#383a3f" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="4.5" fill="#f4f5f7" />
            <path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3" stroke="#888c96" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="landing-brand-name">Capsule</span>
          <span className="landing-badge">macOS</span>
        </div>

        <div className="landing-header-links">
          <a
            href="https://github.com/realbakari/Capsule-App"
            target="_blank"
            rel="noreferrer"
            className="landing-nav-link"
          >
            GitHub
          </a>
          <a
            href="https://github.com/realbakari/Capsule-App/releases"
            target="_blank"
            rel="noreferrer"
            className="landing-nav-link"
          >
            Releases
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-pill">
            <SparkIcon size={14} />
            <span>Developer Preview for macOS</span>
          </div>

          <h1 className="landing-title">
            The local-first workspace for AI agents.
          </h1>

          <p className="landing-subtitle">
            Run, steer, and verify autonomous coding agents with local filesystem access,
            ACP harness process management, and packed capabilities from the skills.sh ecosystem.
          </p>

          <div className="landing-actions-row">
            <a
              href="https://github.com/realbakari/Capsule-App/releases"
              target="_blank"
              rel="noreferrer"
              className="landing-btn-primary"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              <span>Download for macOS</span>
            </a>

            <a
              href="https://github.com/realbakari/Capsule-App"
              target="_blank"
              rel="noreferrer"
              className="landing-btn-secondary"
            >
              <span>View Source on GitHub</span>
            </a>
          </div>

          <div className="landing-install-bar">
            <span className="landing-install-prefix">$</span>
            <code className="landing-install-code">{cloneCmd}</code>
            <button
              type="button"
              className="landing-copy-btn"
              onClick={() => void handleCopy(cloneCmd)}
              title="Copy setup command"
            >
              {copied === cloneCmd ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            </button>
          </div>

          <div className="landing-meta-specs">
            <span>Apple Silicon (M1/M2/M3/M4) & Intel</span>
            <span className="dot">•</span>
            <span>macOS 13+</span>
            <span className="dot">•</span>
            <span>MIT License</span>
          </div>
        </section>

        {/* Feature Cards Grid */}
        <section className="landing-features">
          <div className="landing-cards-grid">
            <div className="landing-feature-card">
              <div className="landing-icon-wrap">
                <FolderIcon size={18} />
              </div>
              <h3>Local-First & Sandboxed</h3>
              <p>
                Zero cloud lock-in. Reads and edits repository files directly with explicit filesystem boundaries and embedded SQLite state.
              </p>
            </div>

            <div className="landing-feature-card">
              <div className="landing-icon-wrap">
                <TerminalIcon size={18} />
              </div>
              <h3>ACP Operator Lifecycle</h3>
              <p>
                First-class Claude Code, Codex, and official acpx runtimes with operator-level steering, timeouts, and permission profiles.
              </p>
            </div>

            <div className="landing-feature-card">
              <div className="landing-icon-wrap">
                <SparkIcon size={18} />
              </div>
              <h3>skills.sh & Packed Catalog</h3>
              <p>
                Direct access to over 9,600+ skills and curated skill packs. Inspect instructions and procedural guides before attaching.
              </p>
            </div>

            <div className="landing-feature-card">
              <div className="landing-icon-wrap">
                <ShieldIcon size={18} />
              </div>
              <h3>Run Contracts & Verification</h3>
              <p>
                Every run generates auditable events, approval gates, and structured verification artifacts to guarantee stability.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <span>Capsule</span>
            <p>Local-first macOS workspace for AI agents</p>
          </div>
          <div className="landing-footer-links">
            <a href="https://github.com/realbakari/Capsule-App" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="https://github.com/realbakari/Capsule-App/releases" target="_blank" rel="noreferrer">
              Releases
            </a>
            <a href="https://skills.sh" target="_blank" rel="noreferrer">
              skills.sh
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
