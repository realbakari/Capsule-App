import { useState } from "react";
import {
  SparkIcon,
  TerminalIcon,
  ShieldIcon,
  CopyIcon,
  CheckIcon,
  FolderIcon,
  GitBranchIcon,
  CpuIcon,
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
      {/* Background Gradients */}
      <div className="landing-ambient-glow" />

      {/* Navigation Header */}
      <header className="landing-header">
        <div className="landing-brand">
          <div className="landing-logo-mark">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="6" fill="#18191b" stroke="#383a3f" strokeWidth="1.5" />
              <circle cx="12" cy="12" r="4.5" fill="#f4f5f7" />
              <path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3" stroke="#888c96" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <span className="landing-brand-name">Capsule</span>
          <span className="landing-badge">macOS</span>
        </div>

        <div className="landing-header-links">
          <a href="#features" className="landing-nav-link">Features</a>
          <a href="#skills" className="landing-nav-link">Skills.sh</a>
          <a href="#harness" className="landing-nav-link">Harnesses</a>
          <a
            href="https://github.com/realbakari/Capsule-App"
            target="_blank"
            rel="noreferrer"
            className="landing-nav-link github"
          >
            GitHub
          </a>
          <a href="#download" className="landing-cta-sm">
            Download App
          </a>
        </div>
      </header>

      {/* Hero Section */}
      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-pill">
            <SparkIcon size={14} className="landing-spark-icon" />
            <span>Developer Preview for macOS</span>
          </div>

          <h1 className="landing-title">
            The local-first workspace for <span className="landing-title-highlight">AI agents</span>.
          </h1>

          <p className="landing-subtitle">
            Run, steer, and verify autonomous coding agents with local filesystem access,
            ACP harness process management, and packed capabilities from the skills.sh ecosystem.
          </p>

          <div className="landing-actions-row" id="download">
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
            <span>Requires macOS 13+</span>
            <span className="dot">•</span>
            <span>MIT Open Source</span>
          </div>
        </section>

        {/* Window Mockup Preview */}
        <section className="landing-preview-section">
          <div className="landing-window-card">
            <div className="landing-window-bar">
              <div className="landing-window-dots">
                <span className="window-dot red" />
                <span className="window-dot yellow" />
                <span className="window-dot green" />
              </div>
              <div className="landing-window-title">Capsule — Workspace (Local)</div>
              <div className="landing-window-harness-badge">
                <span className="harness-dot live" />
                <span>Claude Code Harness</span>
              </div>
            </div>

            <div className="landing-mock-body">
              {/* Sidebar Mock */}
              <div className="landing-mock-sidebar">
                <div className="mock-section-label">PROJECTS</div>
                <div className="mock-item active">
                  <FolderIcon size={14} />
                  <span>Capsule-App</span>
                </div>
                <div className="mock-item">
                  <FolderIcon size={14} />
                  <span>Next-Web-Service</span>
                </div>

                <div className="mock-section-label" style={{ marginTop: "1rem" }}>LIBRARY</div>
                <div className="mock-item">
                  <SparkIcon size={14} />
                  <span>Skills Directory</span>
                </div>
                <div className="mock-item">
                  <CpuIcon size={14} />
                  <span>Runtimes & ACP</span>
                </div>
              </div>

              {/* Chat View Mock */}
              <div className="landing-mock-chat">
                <div className="mock-message user">
                  <div className="mock-bubble user-bubble">
                    Refactor the skills.sh client with live Vercel OIDC bearer token and add offline fallback.
                  </div>
                </div>

                <div className="mock-message agent">
                  <div className="mock-bubble agent-bubble">
                    <div className="mock-run-badge">
                      <span className="run-pulse" />
                      <span>Run #12 · Verified Contract Passed</span>
                    </div>
                    <p>
                      Updated <code>SkillsShClient</code> to support <code>VERCEL_OIDC_TOKEN</code> authentication,
                      enabling access to <strong>9,694+ skills</strong> across the live directory.
                    </p>
                    <div className="mock-diff-card">
                      <div className="mock-diff-header">
                        <GitBranchIcon size={13} />
                        <span>packages/skills/src/client.ts</span>
                        <span className="diff-tag">+34 -1</span>
                      </div>
                      <pre className="mock-code">
{`+ const token = process.env.VERCEL_OIDC_TOKEN;
+ headers: { Authorization: \`Bearer \${token}\` }`}
                      </pre>
                    </div>
                  </div>
                </div>

                <div className="mock-composer">
                  <span className="mock-composer-text">Ask anything, $skill, or /harness…</span>
                  <div className="mock-send-btn">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Highlights Grid */}
        <section className="landing-features" id="features">
          <div className="landing-section-header">
            <h2 className="landing-section-title">Engineered for Autonomous Precision</h2>
            <p className="landing-section-desc">
              Capsule acts as your command bridge, governing execution, files, and contracts without getting in the way.
            </p>
          </div>

          <div className="landing-cards-grid">
            <div className="landing-feature-card">
              <div className="landing-icon-wrap">
                <FolderIcon size={20} />
              </div>
              <h3>Local-First & Sandboxed</h3>
              <p>
                Zero cloud lock-in. Reads and edits files directly in your repository root with strict path boundaries and embedded SQLite state.
              </p>
            </div>

            <div className="landing-feature-card" id="harness">
              <div className="landing-icon-wrap">
                <TerminalIcon size={20} />
              </div>
              <h3>First-Class ACP Harnesses</h3>
              <p>
                Spawn and dedicate Claude Code, Codex, or official acpx runtimes directly through OpenClaw operators with steer, cancel, and timeout controls.
              </p>
            </div>

            <div className="landing-feature-card" id="skills">
              <div className="landing-icon-wrap">
                <SparkIcon size={20} />
              </div>
              <h3>skills.sh & Packed Catalog</h3>
              <p>
                Browse, search, and batch-install capabilities from the open skills ecosystem or attach packed skills via composer slash commands.
              </p>
            </div>

            <div className="landing-feature-card">
              <div className="landing-icon-wrap">
                <ShieldIcon size={20} />
              </div>
              <h3>Run Contracts & Verification</h3>
              <p>
                Every run generates verifiable events, approval gates, and structured diff artifacts to ensure zero regressions before merging.
              </p>
            </div>
          </div>
        </section>

        {/* Call to Action Banner */}
        <section className="landing-cta-banner">
          <h2>Ready to orchestrate your AI workflows?</h2>
          <p>Download the macOS binary or clone the open-source repository to get started.</p>
          <div className="landing-actions-row">
            <a
              href="https://github.com/realbakari/Capsule-App"
              target="_blank"
              rel="noreferrer"
              className="landing-btn-primary"
            >
              Get Capsule on GitHub
            </a>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <span>Capsule</span>
            <p className="faint">Local-first AI Agent Workspace for macOS</p>
          </div>
          <div className="landing-footer-links">
            <a href="https://github.com/realbakari/Capsule-App" target="_blank" rel="noreferrer">
              GitHub Repository
            </a>
            <a href="https://skills.sh" target="_blank" rel="noreferrer">
              skills.sh Directory
            </a>
            <a href="https://docs.openclaw.ai" target="_blank" rel="noreferrer">
              OpenClaw Protocol
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
