import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "../shell/icons";
import { Arrow, SiteShell } from "./SiteShell";
import { FeatureGrid } from "./FeatureTour";
import { ApprovalArt, CompareArt, HeroStill, ReviewArt, ThreadsArt, ToolsArt } from "./Illustrations";
import { SiteQuestions } from "./PublicPage";
import { AGENTS, DOCS, MAC_DOWNLOAD, RELEASE, RELEASE_URL, REPO, WINDOWS_DOWNLOAD } from "./site-content";
import "./landing.css";

const CLONE_COMMAND = "git clone https://github.com/realbakari/Capsule-App.git && cd Capsule-App && pnpm install && pnpm dev";

/*
 * The real renderer on sample data. It is laid out at a desktop width and
 * scaled down to the column, so a narrower window shows the same composition
 * smaller rather than the app's own cramped breakpoint.
 */
const SHOWCASE_WIDTH = 1180;
const SHOWCASE_HEIGHT = 720;

function Showcase() {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(SHOWCASE_WIDTH);
  const [loaded, setLoaded] = useState(false);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth || SHOWCASE_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(1, width / SHOWCASE_WIDTH);
  return <div className="site-showcase" ref={frame} style={{ height: Math.round(SHOWCASE_HEIGHT * scale) }} data-loaded={loaded ? "" : undefined}>
    <iframe
      className="site-preview" src="/?showcase=1" title="Capsule sample workspace" tabIndex={-1}
      sandbox="allow-scripts allow-same-origin" onLoad={() => setLoaded(true)}
      style={{ width: Math.max(SHOWCASE_WIDTH, width), height: SHOWCASE_HEIGHT, transform: scale < 1 ? `scale(${scale})` : undefined }}
    />
  </div>;
}

function FeatureRow({ id, eyebrow, title, children, points, link, art, flip = false }: {
  id: string; eyebrow: string; title: string; children: ReactNode; points: string[];
  link: { href: string; label: string }; art: ReactNode; flip?: boolean;
}) {
  return <section className={`site-row${flip ? " is-flipped" : ""}`} aria-labelledby={`${id}-title`}>
    <div className="site-row-copy">
      <p className="site-eyebrow">{eyebrow}</p>
      <h2 id={`${id}-title`}>{title}</h2>
      <p className="site-row-lede">{children}</p>
      <ul className="site-points">{points.map((point) => <li key={point}><CheckIcon size={14} />{point}</li>)}</ul>
      <a className="site-text-link" href={link.href}>{link.label}<Arrow external /></a>
    </div>
    <div className="site-row-art">{art}</div>
  </section>;
}

export function LandingPage({ demo = true }: { demo?: boolean }) {
  const [copyState, setCopyState] = useState<"ready" | "copied" | "failed">("ready");
  async function copyCommand() {
    try { await navigator.clipboard.writeText(CLONE_COMMAND); setCopyState("copied"); }
    catch { setCopyState("failed"); }
  }
  return <SiteShell current="/">
    <section className="site-hero" aria-labelledby="site-title">
      <h1 id="site-title" className="site-reveal">A desktop workspace for coding agents</h1>
      <p className="site-hero-lede site-reveal">Capsule runs Claude Code, Codex, Gemini CLI and other coding agents in folders on your computer. Each task gets its own thread, every turn saves a checkpoint, and you review the diff next to the conversation.</p>
      <div className="site-cta site-reveal">
        <a className="site-btn site-btn-primary" href={MAC_DOWNLOAD}>Download for macOS</a>
        <a className="site-btn site-btn-secondary" href={`${DOCS}/getting-started.md`}>Read the guide</a>
      </div>
      <p className="site-platforms site-reveal">Version {RELEASE} · Apple Silicon · <a href="#download">Windows preview</a> · MIT license</p>
    </section>

    <section className="site-shot" aria-label="Capsule sample workspace">
      {demo ? <><Showcase /><p className="site-caption">The real app on sample data. Nothing runs here: no agent, no files.</p></> : <HeroStill />}
    </section>

    <section className="site-agents" aria-labelledby="agents-title">
      <h2 id="agents-title">Works with the agent you already use</h2>
      <ul>{AGENTS.map((name) => <li key={name}>{name}</li>)}<li className="site-agents-more">and other ACP agents</li></ul>
    </section>

    <FeatureRow id="threads" eyebrow="Threads and worktrees" title="Keep each task in its own thread" art={<ThreadsArt />}
      points={["The sidebar shows which threads are working, which need you, and which are done.", "Group threads by project or status, or lay them out as a board.", "Fork a thread from any turn to try another approach."]}
      link={{ href: `${DOCS}/organizing-conversations.md`, label: "Organizing threads" }}>
      A thread is one conversation with one agent in one project. Run it in your checkout, or give it a Git worktree and branch of its own, so agents working at the same time never edit the same files.
    </FeatureRow>
    <FeatureRow id="review" eyebrow="Review" title="See what each turn changed" art={<ReviewArt />} flip
      points={["Restore files, the conversation, or both to any earlier turn. Redo undoes a restore.", "Compare shows what a restore would change before you run it.", "Save your test command as a project action and record its result on the turn."]}
      link={{ href: `${DOCS}/review.md`, label: "Reviewing changes" }}>
      When a turn finishes, Capsule saves a checkpoint of your folder as a hidden Git ref. The Review panel shows one turn’s changes or everything uncommitted, and you keep or reject each hunk.
    </FeatureRow>
    <FeatureRow id="approvals" eyebrow="Approvals" title="Approve commands before they run" art={<ApprovalArt />}
      points={["Capsule never grants a permanent permission on its own.", "Permission modes and rules in your settings decide what needs asking.", "Stopping a turn cancels the requests it left open."]}
      link={{ href: `${DOCS}/providers.md`, label: "Approvals and permissions" }}>
      When an agent asks to run a command or edit a file, you see the exact command and the folder it runs in. Approve it once, or deny it and tell the agent what to do instead.
    </FeatureRow>
    <FeatureRow id="tools" eyebrow="Terminal, browser, files" title="Your tools sit beside the chat" art={<ToolsArt />} flip
      points={["Save build and test commands as project actions.", "Select terminal output and press ⌘L to add it to your message.", "On a Mac, run iOS apps in the Simulator panel."]}
      link={{ href: `${DOCS}/projects-and-previews.md`, label: "Projects and previews" }}>
      The terminal opens in the thread’s folder. Click a local address in its output and the page opens in Capsule’s browser; click a path like <code>src/app.ts:12</code> and it opens in Files.
    </FeatureRow>
    <FeatureRow id="compare" eyebrow="Compare agents" title="Run one prompt on several agents" art={<CompareArt />}
      points={["Pick the same agent twice with different models to compare models.", "Each candidate gets its own branch, so nothing is merged until you choose."]}
      link={{ href: `${DOCS}/best-of-n.md`, label: "Running one prompt on several agents" }}>
      Send a task to two, three or four agents at once. Each works in its own worktree. Compare shows how long each took and how much it changed, so you can keep the best result.
    </FeatureRow>

    <FeatureGrid />

    <section className="site-section site-runs" aria-labelledby="runs-title">
      <div className="site-section-head"><p className="site-eyebrow">How it runs</p><h2 id="runs-title">Your agent does the work. Capsule is the workspace around it.</h2></div>
      <div className="site-runs-grid">
        <article><h3>The agent runs on your computer</h3><p>Capsule starts the agent’s own CLI and talks to it over the Agent Client Protocol. The agent keeps its sign-in, its models and its coding loop.</p></article>
        <article><h3>There is nothing to subscribe to</h3><p>Capsule has no account and sells no model access. Your agent’s subscription or API usage is billed by its provider, as it is today.</p></article>
        <article><h3>Records stay on your computer</h3><p>Threads and runs are kept in a local database, and checkpoints in your repository. Your agent sends prompts and code to its own provider.</p></article>
      </div>
      <p className="site-runs-note">An optional Gateway can carry turns instead, for messaging channels and remote agents. A thread keeps the route it started on. <a href={`${DOCS}/compatibility.md`}>Supported behavior and limits</a></p>
    </section>

    <section id="download" className="site-section site-download" aria-labelledby="download-title">
      <div className="site-section-head"><p className="site-eyebrow">Download</p><h2 id="download-title">Download Capsule {RELEASE}</h2><p>Free, with no account. <a href={RELEASE_URL}>Release notes and checksums</a></p></div>
      <div className="site-download-grid">
        <article>
          <div><h3>macOS</h3><p>Apple Silicon. Signed and notarized.</p></div>
          <a className="site-btn site-btn-primary" href={MAC_DOWNLOAD}>Download for macOS</a>
          <p className="site-fine">Open the disk image and drag Capsule to Applications.</p>
        </article>
        <article>
          <div><h3>Windows <span className="site-tag">Preview</span></h3><p>Windows 10 or 11, x64. Not yet signed.</p></div>
          <a className="site-btn site-btn-secondary" href={WINDOWS_DOWNLOAD}>Download for Windows</a>
          <p className="site-fine">Windows may warn about an unknown publisher. <a href={`${DOCS}/windows.md`}>Installing the preview</a></p>
        </article>
      </div>
      <details className="site-source">
        <summary className="site-summary"><span>Build from source</span><svg className="site-chevron" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></summary>
        <div className="site-source-body">
          <p>Needs Node.js 22 or newer and pnpm 10 or newer.</p>
          <div className="site-clone"><code>{CLONE_COMMAND}</code><button type="button" className="site-copy" onClick={() => void copyCommand()} aria-label="Copy the build command">
            <span className="site-icon-swap" data-state={copyState === "copied" ? "done" : "idle"}><CopyIcon size={15} /><CheckIcon size={15} /></span>
          </button></div>
          <p className="site-fine" role="status">{copyState === "copied" ? "Command copied." : copyState === "failed" ? "Couldn’t reach the clipboard. Select and copy the command above." : "It installs dependencies and starts the desktop app."}</p>
          <a className="site-text-link" href={`${REPO}/blob/main/CONTRIBUTING.md`}>Contributor setup<Arrow external /></a>
        </div>
      </details>
    </section>

    <section className="site-section site-setup" aria-labelledby="setup-title">
      <div className="site-section-head"><p className="site-eyebrow">Before you install</p><h2 id="setup-title">What you need</h2><a className="site-text-link" href="/faq">All questions<Arrow /></a></div>
      <SiteQuestions compact />
    </section>
  </SiteShell>;
}
