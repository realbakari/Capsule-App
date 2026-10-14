import { useState } from "react";
import { CheckIcon, CopyIcon } from "../shell/icons";
import { SiteShell } from "./SiteShell";
import { FeatureTour, FeatureGrid } from "./FeatureTour";
import { SiteQuestions } from "./PublicPage";
import { ASSETS, DOCS, RELEASE, RELEASE_URL, REPO } from "./site-content";
import "./landing.css";

const CLONE_COMMAND = "git clone https://github.com/realbakari/Capsule-App.git && cd Capsule-App && pnpm install && pnpm dev";
const HARNESSES = ["Claude Code", "Codex", "Grok Build", "Cursor", "OpenCode", "Gemini CLI", "GitHub Copilot"];

function CompactPreview() {
  return <figure className="site-compact-preview">
    <figcaption>Sample task · Sidebar layout</figcaption>
    <div className="site-sample-prompt">The sidebar truncates thread titles too early. Can you look at why?</div>
    <p className="site-sample-label">Agent response</p>
    <p>Unused columns take space from the title. Collapse the empty pin slot and move the menu out of the row layout.</p>
    <div className="site-sample-diff" aria-label="Illustrative CSS change">
      <div>styles.css <span>1 line changed</span></div>
      <pre><code><span className="site-diff-removed">- grid-template-columns: 2.15rem auto minmax(0, 1fr) auto;</span>{"\n"}<span className="site-diff-added">+ grid-template-columns: auto minmax(0, 1fr);</span></code></pre>
    </div>
    <p className="site-note">A compact illustration of a task and its diff, not a live agent session.</p>
  </figure>;
}

export function LandingPage({ demo = true }: { demo?: boolean }) {
  const [copyState, setCopyState] = useState<"ready" | "copied" | "failed">("ready");
  async function copyCommand() {
    try { await navigator.clipboard.writeText(CLONE_COMMAND); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  }
  return <SiteShell>
      <section className="site-hero" aria-labelledby="site-title">
        <p className="site-hero-badge"><span aria-hidden="true" />Local-first. Open source.</p>
        <h1 id="site-title">A place for your agents.<br /><em>And the work you make.</em></h1>
        <p className="site-lede">Bring your coding agents into one calm workspace.<br className="site-desktop-break" /> Follow the task, review the changes, and make them yours.</p>
        <div className="site-cta">
          <a className="site-btn-primary" href="#download">Download Capsule <span aria-hidden="true">↗</span></a>
          <a className="site-btn-ghost" href="/features">Explore the workspace</a>
        </div>
        <p className="site-note">macOS Apple Silicon <span aria-hidden="true">·</span> Windows x64 preview</p>
      </section>
      <section className="site-shot" aria-label="Capsule sample workspace">
        {demo ? <>
          <div className="site-shot-wrapper"><div className="site-shot-caption"><span>CAPSULE / WORKSPACE</span><span>Sample project · Read-only</span></div><div className="site-shot-frame">
            <iframe className="site-preview" src="/?showcase=1" title="Capsule sample workspace preview" loading="lazy" sandbox="allow-scripts allow-same-origin" />
          </div></div>
          <p className="site-note site-shot-note">The real interface on read-only sample data. No agent runs in this preview.</p>
        </> : <CompactPreview />}
      </section>
      <FeatureTour />
      <FeatureGrid />
      <section id="workflow" className="site-section site-workflow" aria-labelledby="workflow-title">
        <p className="site-eyebrow">From first prompt to final diff</p>
        <h2 id="workflow-title">Less switching.<br />More seeing it through.</h2>
        <div className="site-workflow-grid">
          <article><span className="site-step">01 / Start</span><h3>Give each task a conversation.</h3><p>Choose a project and an available agent. Use your checkout, or give the conversation a separate Git worktree.</p><a href={`${DOCS}/getting-started.md`}>Start your first conversation ↗</a></article>
          <article><span className="site-step">02 / Follow</span><h3>See what the agent is doing.</h3><p>Read its reply and reported tool activity. Inspect approval requests and stop a turn when you need to change direction.</p><a href={`${DOCS}/composer.md`}>Explore conversation controls ↗</a></article>
          <article><span className="site-step">03 / Review</span><h3>Inspect the diff before you commit.</h3><p>Review changed files beside the conversation. Open a terminal or preview your local app without leaving the workspace.</p><a href={`${DOCS}/projects-and-previews.md`}>Explore project tools ↗</a></article>
          <article><span className="site-step">04 / Recover</span><h3>Return to a saved checkpoint.</h3><p>Git-backed turns keep a record of changes. Inspect a saved diff and review the restore confirmation before changing files.</p><a href={`${DOCS}/checkpoints.md`}>Understand checkpoints ↗</a></article>
        </div>
      </section>
      <section id="agents" className="site-section" aria-labelledby="agents-title">
        <p className="site-eyebrow">Bring your agent</p>
        <h2 id="agents-title">Your agent. Your account.<br />A little more room to work.</h2>
        <p className="site-lede">Your coding agent runs the task and owns its model access. Capsule provides the workspace, without reselling tokens.</p>
        <ul className="site-harness-grid">{HARNESSES.map((name) => <li key={name}><CheckIcon size={14} /><span>{name}</span></li>)}</ul>
        <p className="site-note">Setup and available controls vary by agent, adapter, and runtime route.</p>
        <a className="site-text-link" href={`${DOCS}/providers.md`}>Check agent requirements ↗</a>
      </section>
      <section id="setup" className="site-section site-questions" aria-labelledby="setup-title">
        <div><p className="site-eyebrow">Before you start</p><h2 id="setup-title">A few things<br />worth knowing.</h2><a className="site-text-link" href={`${DOCS}/getting-started.md`}>Read the getting started guide ↗</a></div>
        <div><SiteQuestions compact /><a className="site-text-link" href="/faq">All questions, including privacy ↗</a></div>
      </section>
      <section id="download" className="site-section site-download" aria-labelledby="download-title">
        <p className="site-eyebrow">Get Capsule</p>
        <h2 id="download-title">Make room for your next idea.</h2>
        <p className="site-note">Version {RELEASE} · <a href={RELEASE_URL}>Release notes and checksums</a></p>
        <div className="site-download-grid">
          <article><h3>macOS</h3><p>Apple Silicon · arm64</p><a className="site-btn-primary" href={`${ASSETS}/Capsule-${RELEASE}-arm64.dmg`}>Download for macOS</a><p className="site-note">Open the disk image and move Capsule to Applications.</p></article>
          <article><h3>Windows preview</h3><p>Windows 10 or 11 · x64</p><a className="site-btn-ghost" href={`${ASSETS}/Capsule-${RELEASE}-x64-setup.exe`}>Download for Windows</a><p className="site-note">Unsigned preview. Windows may show an unknown-publisher warning. <a href={`${DOCS}/windows.md`}>Read installation guidance.</a></p></article>
        </div>
        <p className="site-note">Agent accounts and usage costs are separate. <a href={`${DOCS}/compatibility.md`}>Review compatibility and limits.</a></p>
        <details className="site-source"><summary>Build from source</summary><p>Requires Node.js 22 or newer and pnpm 10 or newer.</p>
          <div className="site-clone"><code>{CLONE_COMMAND}</code><button type="button" className="site-copy" onClick={() => void copyCommand()} aria-label="Copy source installation command">{copyState === "copied" ? <CheckIcon size={15} /> : <CopyIcon size={15} />}</button></div>
          <p className="site-note" role="status">{copyState === "copied" ? "Command copied." : copyState === "failed" ? "Clipboard unavailable. Select and copy the command above." : "The command downloads dependencies and starts the desktop app."}</p>
          <a className="site-text-link" href={`${REPO}/blob/main/CONTRIBUTING.md`}>Contributor setup ↗</a>
        </details>
      </section>
  </SiteShell>;
}
