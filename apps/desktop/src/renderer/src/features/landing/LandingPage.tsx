import { useState } from "react";
import App from "../../App";
import { CheckIcon, CopyIcon } from "../shell/icons";

const REPO = "https://github.com/realbakari/Capsule-App";
const CLONE_COMMAND =
  "git clone https://github.com/realbakari/Capsule-App.git && cd Capsule-App && pnpm install && pnpm dev";

/*
 * The harnesses Capsule drives, with the CLI it spawns through acpx. Mirrored
 * from PRESET_HARNESSES rather than imported: the shared barrel reaches
 * node:crypto, which cannot bundle for a browser context. Keep these in step
 * with packages/shared/src/harness.ts.
 */
const HARNESSES: Array<{ name: string; cli: string }> = [
  { name: "Claude Code", cli: "claude" },
  { name: "Codex", cli: "codex" },
  { name: "Grok Build", cli: "grok" },
  { name: "Cursor", cli: "cursor-agent" },
  { name: "OpenCode", cli: "opencode" },
  { name: "Gemini CLI", cli: "gemini" },
  { name: "GitHub Copilot", cli: "copilot" },
];

const POINTS = [
  "No keys resold. Your subscription, your quota.",
  "Every project stays on your machine.",
  "Switch harness per conversation.",
];

/**
 * The public page: a scrolling site rather than the app with a card over it.
 *
 * `demo` renders the real application as the product shot. It runs on a
 * read-only bridge — no gateway, no agent, nothing written to disk — which is
 * why it can sit on a public page at all. It is off below the breakpoint,
 * because Capsule's three-column shell collapses on a phone into something
 * that misrepresents the product rather than showing it.
 */
export function LandingPage({ demo = true }: { demo?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(CLONE_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access can be refused; the command stays selectable.
    }
  }

  return (
    <div className="site">
      <header className="site-bar">
        <span className="site-mark">
          <img src="./icon.png" alt="" width={22} height={22} />
          Capsule
        </span>
        <a href={REPO} target="_blank" rel="noreferrer" className="site-bar-link">
          Source
        </a>
      </header>

      <section className="site-hero">
        <img className="site-hero-mark" src="./icon.png" alt="" width={72} height={72} />
        <h1>A desktop workspace for the coding agents you already run.</h1>
        <p className="site-lede">
          Capsule drives Claude Code, Codex, Grok Build and other ACP harnesses from one window —
          projects, conversations, diffs and approvals, on your own machine.
        </p>
        <div className="site-cta">
          <a className="site-btn-primary" href={`${REPO}/releases`} target="_blank" rel="noreferrer">
            Download for macOS
          </a>
          <a className="site-btn-ghost" href={REPO} target="_blank" rel="noreferrer">
            Read the source ↗
          </a>
        </div>
        <p className="site-note">Apple Silicon and Intel · macOS 13+</p>
      </section>

      {demo && (
        <section className="site-shot" aria-label="Capsule running on sample data">
          <div className="site-shot-wrapper">
            <div className="site-shot-glow" aria-hidden />
            <div className="site-shot-frame">
              <div className="site-shot-traffic-lights" aria-hidden>
                <span className="traffic-dot close" />
                <span className="traffic-dot minimize" />
                <span className="traffic-dot maximize" />
              </div>
              <App />
            </div>
          </div>
          <p className="site-note site-shot-note">
            The real interface on sample data. Nothing here reaches a gateway or your disk.
          </p>
        </section>
      )}

      <section className="site-section">
        <p className="site-eyebrow">Your subscription</p>
        <h2>No keys. No quota of ours.</h2>
        <p className="site-lede">
          Capsule drives the CLIs already installed and signed in on your machine. It never resells
          tokens and never asks for an API key.
        </p>
        <ul className="site-harness-grid">
          {HARNESSES.map((harness) => (
            <li key={harness.cli}>
              <span>{harness.name}</span>
              <code>{harness.cli}</code>
            </li>
          ))}
        </ul>
        <ul className="site-points">
          {POINTS.map((point) => (
            <li key={point}>
              <CheckIcon size={14} />
              {point}
            </li>
          ))}
        </ul>
      </section>

      <section className="site-section">
        <p className="site-eyebrow">Requirements</p>
        <h2>Three things, all local.</h2>
        <div className="site-needs">
          <div>
            <h3>A running OpenClaw Gateway</h3>
            <p>
              With the acpx plugin enabled. Capsule talks to it over a local WebSocket; it does not
              install or authenticate anything itself.
            </p>
          </div>
          <div>
            <h3>At least one harness</h3>
            <p>
              Any of the CLIs above, installed and signed in on the machine running the Gateway.
            </p>
          </div>
          <div>
            <h3>Nothing else</h3>
            <p>
              Projects, conversations, runs and approvals live in a SQLite file on your machine.
              There is no account and no server of ours.
            </p>
          </div>
        </div>
      </section>

      <section className="site-section site-close">
        <p className="site-eyebrow">Open source</p>
        <h2>Run it from source today.</h2>
        <p className="site-lede">A pnpm workspace and an Electron app. Clone, install, open.</p>
        <div className="site-clone">
          <code className="mono">{CLONE_COMMAND}</code>
          <button
            type="button"
            className="site-copy"
            onClick={() => void copyCommand()}
            title="Copy command"
            aria-label="Copy command"
          >
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </button>
        </div>
      </section>

      <footer className="site-footer">
        <span>Capsule</span>
        <a href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </footer>
    </div>
  );
}
