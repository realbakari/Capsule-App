import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "../shell/icons";

const REPO = "https://github.com/realbakari/Capsule-App";
const CLONE_COMMAND =
  "git clone https://github.com/realbakari/Capsule-App.git && cd Capsule-App && pnpm install && pnpm dev";

/*
 * The harnesses Capsule drives, with the CLI it actually spawns through acpx.
 * Mirrored from PRESET_HARNESSES rather than imported: the shared barrel
 * reaches node:crypto, which cannot bundle for a browser context. Keep the
 * commands in step with packages/shared/src/harness.ts.
 *
 * One column, one meaning — the executable Capsule looks for. An earlier pass
 * put a sign-in command in the rows that had one and the binary in the rest,
 * which read as though `claude` and `codex login` were the same kind of thing.
 */
const HARNESSES: Array<{ name: string; cli: string }> = [
  { name: "Claude Code", cli: "claude" },
  { name: "Codex", cli: "codex" },
  { name: "Cursor", cli: "cursor-agent" },
  { name: "OpenCode", cli: "opencode" },
  { name: "Gemini CLI", cli: "gemini" },
  { name: "GitHub Copilot", cli: "copilot" },
];

/*
 * The web URL renders the real application over a read-only demo bridge, with
 * a small teaser card on top; "Get started" opens the panel below.
 *
 * `standalone` is the narrow-viewport form. Capsule's shell is a three-column
 * desktop layout, so on a phone the demo misrepresents the product rather than
 * showing it — there, the panel is the whole page and nothing sits behind it.
 */
export function LandingPage({ standalone = false }: { standalone?: boolean }) {
  const [open, setOpen] = useState(standalone);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || standalone) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, standalone]);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(CLONE_COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access can be refused; the command stays selectable.
    }
  }

  const panel = (
    <div className="landing-modal" role="dialog" aria-modal="true" aria-label="Get Capsule">
      {!standalone && (
        <button
          className="landing-modal-close"
          onClick={() => setOpen(false)}
          title="Close"
          aria-label="Close"
        >
          ×
        </button>
      )}

      <img src="./icon.png" alt="" width={56} height={56} className="landing-modal-mark" />
      <h2>Capsule</h2>
      <p className="landing-modal-tagline">
        Run Claude Code and Codex from a desktop workspace, on your own machine.
      </p>

      <a
        className="landing-btn-primary landing-modal-cta"
        href={`${REPO}/releases`}
        target="_blank"
        rel="noreferrer"
      >
        Download for macOS
      </a>
      <p className="landing-modal-sub">
        Apple Silicon and Intel · macOS 13+ ·{" "}
        <a href={REPO} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </p>

      <div className="landing-harnesses">
        <p className="landing-harnesses-lede">
          Bring your own subscription. Capsule drives these CLIs where they are already installed
          and signed in — it never resells tokens and never asks for an API key.
        </p>
        <ul>
          {HARNESSES.map((harness) => (
            <li key={harness.cli}>
              <span className="landing-harness-name">{harness.name}</span>
              <code>{harness.cli}</code>
            </li>
          ))}
        </ul>
      </div>

      <button className="landing-modal-link" onClick={() => setShowSource((value) => !value)}>
        {showSource ? "Hide source instructions" : "Run from source ›"}
      </button>
      {showSource && (
        <div className="landing-install-bar">
          <span className="landing-install-prefix" aria-hidden>
            $
          </span>
          <code className="landing-install-code">{CLONE_COMMAND}</code>
          <button
            type="button"
            className="landing-copy-btn"
            onClick={() => void copyCommand()}
            title="Copy command"
            aria-label="Copy command"
          >
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </button>
        </div>
      )}

      <div className="landing-modal-rows">
        <details>
          <summary>What Capsule needs to run</summary>
          <p>
            A running OpenClaw Gateway with the acpx plugin, and at least one of the CLIs above
            installed and signed in on that host. Capsule does not install or authenticate them.
          </p>
        </details>
        <details>
          <summary>Where your data lives</summary>
          <p>
            Projects, conversations, runs and approvals are kept in a local SQLite database on your
            machine. Capsule reads and edits files inside the project folder you choose, and nowhere
            else.
          </p>
        </details>
        {!standalone && (
          <details>
            <summary>About this page</summary>
            <p>
              You are looking at the real interface running on sample data — no gateway, no agent,
              nothing written to disk.
            </p>
          </details>
        )}
      </div>
    </div>
  );

  if (standalone) return <div className="landing-standalone">{panel}</div>;

  return (
    <>
      <aside className="landing-card" aria-label="About Capsule">
        <img src="./icon.png" alt="" width={20} height={20} className="landing-mark" />
        <div className="landing-card-text">
          <span className="landing-brand-name">Capsule</span>
          <p>A desktop workspace for the coding agents you already run.</p>
        </div>
        <button className="landing-btn-primary" onClick={() => setOpen(true)}>
          Get started
        </button>
      </aside>

      {open && (
        <div
          className="landing-modal-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          {panel}
        </div>
      )}
    </>
  );
}
