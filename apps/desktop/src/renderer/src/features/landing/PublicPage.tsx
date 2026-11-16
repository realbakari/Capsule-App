import { useState } from "react";
import { FeatureGrid, FeatureTour } from "./FeatureTour";
import { Arrow, SiteShell } from "./SiteShell";
import { AGENTS, DOCS, GUIDES, MAC_DOWNLOAD, PUBLIC_PAGES, RELEASE, RELEASE_DATE, RELEASE_URL, REPO, type PublicPageSlug } from "./site-content";

const QUESTIONS = [
  { group: "Getting started", question: "What do I need before I install?", answer: "A supported coding agent, installed and signed in with its own setup, and a project folder. Some agents need an ACP adapter as well. Capsule does not install agents or provide an account for them.", file: "providers.md" },
  { group: "Getting started", question: "Do I need a Gateway?", answer: "No. New installations run local agents directly. A Gateway is an optional route for messaging channels and remote agents, and a thread keeps whichever route it started on.", file: "providers.md" },
  { group: "Getting started", question: "Does Capsule include model access?", answer: "No. Your agent’s subscription or API usage is billed by its provider. The models and controls you see come from your agent and its account.", file: "providers.md" },
  { group: "Your work", question: "Where does my work go?", answer: "Threads, runs and settings are stored on your computer, and checkpoints in your repository. Your agent sends prompts, code and tool output to its own provider. Connected services handle data under their own terms.", href: "/privacy" },
  { group: "Your work", question: "Does a finished turn mean the code works?", answer: "No. A finished turn means the agent stopped. Review the diff and run your checks; Capsule records a check as verification only when one actually ran.", file: "verification.md" },
  { group: "Your work", question: "Can I undo what an agent did?", answer: "In a Git repository, yes. Every finished turn saves a checkpoint, and you can restore files, the conversation, or both to it. Compare shows what a restore would change first. Checkpoints are not a backup of your project.", file: "checkpoints.md" },
  { group: "Other devices", question: "Can I use Capsule from a browser or phone?", answer: "Yes, by pairing it with a computer running Capsule. A pairing is read-only unless you grant conversation control. Agents keep running on the computer, never on the paired device.", file: "reading-from-another-device.md" },
  { group: "Other devices", question: "Does Capsule run on Windows?", answer: "There is a preview for Windows 10 and 11 on x64. It is not yet signed, and not every agent has been tested on Windows. Read the installation notes first.", file: "windows.md" },
  { group: "Other devices", question: "Can a shared channel use my local agent?", answer: "Yes. Shared channels go through a relay, and Capsule can route a channel’s work to an agent on your computer. That needs the route configured and Capsule running.", file: "channels.md" },
] as const;

function Chevron() {
  return <svg className="site-chevron" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function SiteQuestions({ compact = false }: { compact?: boolean }) {
  const groups = compact ? ["Getting started"] : ["Getting started", "Your work", "Other devices"];
  return <div className="site-faq-groups">{groups.map((group) => <section key={group}>{!compact && <h2>{group}</h2>}<div className="site-question-list">{QUESTIONS.filter((item) => item.group === group).map((item) => <details key={item.question}><summary className="site-summary"><span>{item.question}</span><Chevron /></summary><div className="site-answer"><p>{item.answer}</p><a className="site-text-link" href={"file" in item ? `${DOCS}/${item.file}` : item.href}>Read more<Arrow external={"file" in item} /></a></div></details>)}</div></section>)}</div>;
}

const CATEGORIES = ["All guides", "Getting started", "Workflow", "Connections"] as const;

function Resources() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All guides");
  const [query, setQuery] = useState("");
  const visible = GUIDES.filter((guide) => (category === "All guides" || guide.category === category) && `${guide.title} ${guide.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <div className="site-resource-controls">
      <div className="site-filter-group" role="group" aria-label="Guide categories">{CATEGORIES.map((name) => <button type="button" key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>
      <label className="site-search"><span className="sr-only">Search guides</span><input type="search" placeholder="Search guides" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    </div>
    <p className="site-fine site-result-count" role="status">{visible.length} {visible.length === 1 ? "guide" : "guides"}</p>
    <div className="site-resource-grid">{visible.map((guide) => <a className="site-resource-card" href={`${DOCS}/${guide.file}`} key={guide.file}><span className="site-eyebrow">{guide.category}</span><h2>{guide.title}<Arrow external /></h2><p>{guide.description}</p></a>)}</div>
    {!visible.length && <div className="site-empty"><h2>No matching guides</h2><p>Nothing in this category matches “{query.trim()}”. Try another word, or show every guide.</p><button type="button" className="site-btn site-btn-secondary" onClick={() => { setQuery(""); setCategory("All guides"); }}>Show all guides</button></div>}
    <div className="site-callout"><div><h2>Can’t find it?</h2><p>Every guide is also in the repository, next to the code it describes.</p></div><a className="site-btn site-btn-secondary" href={`${REPO}/tree/main/docs/user`}>All guides on the project page</a></div>
  </>;
}

function About() {
  return <div className="site-prose">
    <p className="site-prose-lead">Capsule is a workspace for the coding agents you already use. It does not replace them.</p>
    <p>A coding agent is good at changing code. Around each change there is more to keep track of: which folder it ran in, what you asked, the commands it ran, what it changed, and whether the change held up. Capsule keeps those together, one thread per task, on your own computer.</p>
    <h2>Decisions behind it</h2>
    <h3>The agent stays in charge of the coding</h3>
    <p>Capsule talks to each agent over the Agent Client Protocol and leaves its loop, its sign-in and its models alone. It does not reimplement any of them.</p>
    <h3>Your folders, your Git</h3>
    <p>Capsule works in folders you already have. Checkpoints are Git refs in your repository and worktrees are ordinary Git worktrees, so nothing about your project depends on Capsule staying installed.</p>
    <h3>Finished is not the same as correct</h3>
    <p>A reply that says “done” is not a passing test. Capsule shows the diff, records the checks you run, and leaves the judgement to you.</p>
    <h3>The conversation comes first</h3>
    <p>The thread fills the window. Run logs, settings and permission details are one click away, not in front of you before you begin.</p>
    <h3>Open source</h3>
    <p>Capsule is MIT licensed and developed in public. Issues and every release are on the <a href={REPO}>project page</a>.</p>
  </div>;
}

function Updates() {
  return <div className="site-changelog">
    <article className="site-release">
      <aside><span className="site-release-version">{RELEASE}</span><time dateTime={RELEASE_DATE}>November 14, 2026</time></aside>
      <div>
        <h2>Settings files, commands and hooks for every agent, a task board, and multi-agent runs</h2>
        <ul>
          <li>Preferences live in settings files, per user and per project, with live reload and a published schema.</li>
          <li>Custom commands, hooks, permission rules, agent profiles and key bindings, written once for every agent.</li>
          <li>Theme files with conversation backdrops, a status line, tool servers, automations and plugins.</li>
          <li>A task board, hunk-by-hunk review, and one prompt run on several agents to keep the best result.</li>
          <li>Plan mode, fork and restore, applying a worktree to your checkout, and exporting or sharing a thread.</li>
          <li>Unread markers, settle and snooze, notifications that open their thread, and recovery after a restart.</li>
        </ul>
        <p className="site-fine">Existing projects, threads and settings carry over, and preferences move into settings files automatically. The macOS app is signed and notarized; the Windows build is an unsigned preview.</p>
        <div className="site-release-links"><a className="site-text-link" href={RELEASE_URL}>Full release notes and checksums<Arrow external /></a><a className="site-text-link" href={`${DOCS}/updating.md`}>Updating Capsule<Arrow external /></a></div>
      </div>
    </article>
    <p className="site-fine site-changelog-more">Earlier versions are on the <a href={`${REPO}/releases`}>releases page</a>, and there is a <a href={`${REPO}/releases.atom`}>release feed</a>. In the app, Settings → About checks for updates.</p>
  </div>;
}

function Roadmap() {
  const rows = [
    { status: "Available", title: "Capsule for macOS", text: "Threads and worktrees, review and checkpoints, approvals, the terminal, browser and files panels, multi-agent runs, and pairing a browser.", href: "/features", label: "Features" },
    { status: "Preview", title: "Capsule for Windows", text: "An x64 build for Windows 10 and 11. It is not yet signed, and not every agent has been tested on it.", href: `${DOCS}/windows.md`, label: "Preview notes" },
    { status: "In development", title: "iPhone and iPad", text: "A native app that follows your threads, shows what each turn changed, and answers approvals while agents keep running on your computer.", href: `${DOCS}/mobile-app.md`, label: "How pairing works" },
    { status: "Ongoing", title: "Agent coverage", text: "What each agent supports differs by agent and by runtime route. The compatibility guide lists the known limits.", href: `${DOCS}/compatibility.md`, label: "Compatibility" },
  ];
  return <div className="site-roadmap">
    <p className="site-fine">This is what exists and what is being worked on, not a schedule. Open issues and published releases are the source of truth.</p>
    <ol>{rows.map((row) => <li key={row.title}><span className={`site-status site-status-${row.status.toLowerCase().replace(/\s+/g, "-")}`}>{row.status}</span><div><h2>{row.title}</h2><p>{row.text}</p><a className="site-text-link" href={row.href}>{row.label}<Arrow external={row.href.startsWith("http")} /></a></div></li>)}</ol>
    <div className="site-callout"><div><h2>Something missing?</h2><p>Describe the task, what gets in the way, and what you need to happen.</p></div><a className="site-btn site-btn-secondary" href={`${REPO}/issues/new/choose`}>Open an issue</a></div>
  </div>;
}

function Pricing() {
  return <>
    <div className="site-cost-grid">
      <section>
        <p className="site-eyebrow">Capsule</p>
        <h2>Free</h2>
        <p>Open source under the MIT license. No account, no tiers, no usage limits of its own.</p>
        <a className="site-btn site-btn-primary" href={MAC_DOWNLOAD}>Download for macOS</a>
        <ul><li>Every feature in the app</li><li>Any supported agent, any number of projects</li><li>Checkpoints, review and project tools</li><li>Source code you can read and change</li></ul>
        <a className="site-text-link" href={`${REPO}/blob/main/LICENSE`}>Read the license<Arrow external /></a>
      </section>
      <section>
        <p className="site-eyebrow">Your agent</p>
        <h2>Billed by its provider</h2>
        <p>Your agent’s subscription or API usage is between you and its provider. Capsule does not resell model access.</p>
        <a className="site-btn site-btn-secondary" href={`${DOCS}/providers.md`}>Check agent requirements</a>
        <ul><li>Sign in to the agent with its own setup</li><li>Use the models your account includes</li><li>Your provider’s usage limits still apply</li><li>Some agents need an ACP adapter</li></ul>
      </section>
    </div>
    <section className="site-page-faq" aria-labelledby="pricing-questions"><h2 id="pricing-questions">Before you download</h2><SiteQuestions compact /></section>
  </>;
}

function Support() {
  const routes = [
    { href: "/resources", label: "Guides", title: "Read the guides", text: "Installation, connecting agents, and how each part of the workspace works." },
    { href: `${REPO}/issues/new/choose`, label: "Bug", title: "Report a bug", text: "Open a public issue with steps someone else can follow." },
    { href: `${REPO}/issues`, label: "Known issues", title: "Search existing issues", text: "Someone may have reported it already. Add what you know." },
    { href: "/security", label: "Security", title: "Report a vulnerability", text: "Report privately, as the security policy describes, not in a public issue." },
  ];
  return <>
    <div className="site-support-grid">{routes.map((route) => <a key={route.title} href={route.href}><span className="site-eyebrow">{route.label}</span><h2>{route.title}<Arrow external={route.href.startsWith("http")} /></h2><p>{route.text}</p></a>)}</div>
    <section className="site-prose site-checklist" aria-labelledby="report-title">
      <h2 id="report-title">What a useful bug report includes</h2>
      <ol><li>Your Capsule version and operating system.</li><li>The agent, and whether the thread runs directly or through a Gateway.</li><li>The steps that reproduce the problem.</li><li>What you expected, and what happened instead.</li></ol>
      <p>Issues are public. Remove secrets, pairing links, personal paths and private code from screenshots and logs before you post them.</p>
      <a className="site-text-link" href={`${DOCS}/diagnostics.md`}>Collecting diagnostics safely<Arrow external /></a>
    </section>
  </>;
}

function Features() {
  return <>
    <FeatureTour showIntroduction={false} />
    <section className="site-agents site-agents-page" aria-labelledby="features-agents-title">
      <h2 id="features-agents-title">Works with the agent you already use</h2>
      <ul>{AGENTS.map((name) => <li key={name}>{name}</li>)}<li className="site-agents-more">and other ACP agents</li></ul>
    </section>
    <FeatureGrid />
  </>;
}

export function PublicPage({ slug }: { slug: PublicPageSlug }) {
  const page = PUBLIC_PAGES.find((item) => item.slug === slug)!;
  const content = slug === "features" ? <Features /> : slug === "about" ? <About /> : slug === "updates" ? <Updates /> : slug === "roadmap" ? <Roadmap /> : slug === "pricing" ? <Pricing /> : slug === "resources" ? <Resources /> : slug === "faq" ? <SiteQuestions /> : <Support />;
  return <SiteShell current={`/${slug}`}>
    <header className="site-page-heading"><h1>{page.title}</h1><p>{page.description}</p></header>
    <div className={`site-page-content site-page-${slug}`}>{content}</div>
    {slug !== "pricing" && <section className="site-closing" aria-labelledby="closing-title"><h2 id="closing-title">Download Capsule {RELEASE}</h2><p>Free for macOS on Apple Silicon, with a Windows preview.</p><div className="site-cta"><a className="site-btn site-btn-primary" href={MAC_DOWNLOAD}>Download for macOS</a><a className="site-btn site-btn-secondary" href="/#download">Other platforms</a></div></section>}
  </SiteShell>;
}
