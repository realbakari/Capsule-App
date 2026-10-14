import { useId, useRef, useState } from "react";
import { DOCS } from "./site-content";

const STOPS = [
  { name: "Conversations", title: "A thread for each piece of work.", description: "Keep the request, the agent’s response, and its reported activity together. Return to the conversation without reconstructing the task.", file: "composer.md" },
  { name: "Change review", title: "See exactly what changed.", description: "Review a file’s diff beside the task. A completed reply is a starting point for review, not a claim that the code is correct.", file: "checkpoints.md" },
  { name: "Approvals", title: "Understand the action before allowing it.", description: "Inspect reported operations and decide on the permissions your agent supports. Missing details and unsupported controls remain explicit.", file: "providers.md" },
  { name: "Browser access", title: "Another screen. The same host.", description: "Pair a trusted device to follow your workspace. Read-only is the default; conversation control needs an explicit grant. Your agents still run on the host.", file: "reading-from-another-device.md" },
] as const;

function TourIllustration({ selected }: { selected: number }) {
  if (selected === 1) return <div className="site-tour-diff"><div className="site-tour-toolbar"><span>styles.css</span><span>+1 −1</span></div><pre><code><span className="site-diff-removed">− grid-template-columns: 2rem auto 1fr auto;</span>{"\n"}<span className="site-diff-added">+ grid-template-columns: auto minmax(0, 1fr);</span></code></pre><p className="site-tour-footnote">Saved changes · Review before committing</p></div>;
  if (selected === 2) return <div className="site-tour-approval"><span className="site-example-label">Permission requested</span><h3>Run the project’s checks</h3><code>pnpm test</code><p>The agent is asking to execute this command.</p><div className="site-example-actions" aria-label="Illustrated approval choices"><span>Deny</span><span>Approve once</span></div></div>;
  if (selected === 3) return <div className="site-tour-pair"><div><span className="site-example-label">Your computer</span><strong>Capsule + your agent</strong><span>Execution stays here</span></div><span aria-hidden="true">↔</span><div><span className="site-example-label">Paired browser</span><strong>Follow the conversation</strong><span>Read-only by default</span></div></div>;
  return <div className="site-tour-conversation"><div className="site-tour-prompt">Make the sidebar titles easier to read.</div><p>The empty columns are taking space from the title. I’ll simplify the row layout.</p><div className="site-example-activity"><span>✓ Read styles.css</span><span>✓ Updated the row layout</span><span>1 file changed <b>+1 −1</b></span></div></div>;
}

export function FeatureTour({ showIntroduction = true }: { showIntroduction?: boolean }) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const stop = STOPS[selected]!;
  function select(index: number, focus = false) {
    setSelected(index);
    if (focus) tabs.current[index]?.focus();
  }
  return <section className="site-section site-tour" aria-labelledby={`${id}-title`}>
    {showIntroduction ? <><p className="site-eyebrow">Inside the workspace</p><h2 id={`${id}-title`}>Follow the work.<br />Keep the context.</h2></> : <h2 id={`${id}-title`} className="sr-only">Explore the workspace</h2>}
    <div className="site-tour-tabs" role="tablist" aria-label="Explore the workspace">{STOPS.map((item, index) => <button type="button" role="tab" key={item.name} id={`${id}-tab-${index}`} aria-controls={`${id}-panel`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} ref={(element) => { tabs.current[index] = element; }} onClick={() => select(index)} onKeyDown={(event) => {
      const next = event.key === "ArrowRight" ? (index + 1) % STOPS.length : event.key === "ArrowLeft" ? (index + STOPS.length - 1) % STOPS.length : event.key === "Home" ? 0 : event.key === "End" ? STOPS.length - 1 : undefined;
      if (next !== undefined) { event.preventDefault(); select(next, true); }
    }}>{item.name}</button>)}</div>
    <div className="site-tour-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>
      <div className="site-tour-visual"><span className="site-example-label">Illustrative workflow · not a live session</span><TourIllustration selected={selected} /></div>
      <div className="site-tour-copy"><span className="site-eyebrow">0{selected + 1} / 04</span><h3>{stop.title}</h3><p>{stop.description}</p><a href={`${DOCS}/${stop.file}`}>Read the guide ↗</a></div>
    </div>
  </section>;
}

const FEATURES = [
  { title: "Separate the work", text: "Give a conversation its own Git worktree when tasks should not share a checkout.", file: "projects-and-previews.md", visual: "main → task/sidebar", kind: "branch" },
  { title: "Keep tools nearby", text: "Move between files, terminal output, and your app preview without leaving the task.", file: "projects-and-previews.md", visual: "Files   Terminal   Browser", kind: "tools" },
  { title: "Find your next action", text: "Use the command palette and keyboard shortcuts to move through the workspace.", file: "keyboard-shortcuts.md", visual: "⌘ K", kind: "keys" },
  { title: "Shared channels, real context", text: "Bring people and agents into relay-backed conversations with threads and mentions.", file: "channels.md", visual: "# project   @agent", kind: "channels" },
  { title: "Keep a way back", text: "Inspect saved turn diffs and review a checkpoint restore before changing files.", file: "checkpoints.md", visual: "Request · Change · Checkpoint", kind: "history" },
  { title: "A quieter status check", text: "Let the optional desktop companion show when work is running or needs your attention.", file: "companion.md", visual: "Working → Needs you → Ready", kind: "status" },
] as const;

export function FeatureGrid() {
  return <section className="site-section" aria-labelledby="site-features-title"><p className="site-eyebrow">The small things add up</p><h2 id="site-features-title">A little less scattered.<br />A lot more connected.</h2><div className="site-feature-grid">{FEATURES.map((feature) => <a key={feature.title} href={`${DOCS}/${feature.file}`} className="site-feature-card"><div className={`site-feature-visual site-feature-${feature.kind}`} aria-hidden="true"><span>{feature.visual}</span></div><h3>{feature.title}<span aria-hidden="true">↗</span></h3><p>{feature.text}</p></a>)}</div></section>;
}
