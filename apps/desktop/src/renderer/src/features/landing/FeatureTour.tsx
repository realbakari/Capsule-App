import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Arrow } from "./SiteShell";
import { ApprovalArt, CompareArt, ReviewArt, ThreadsArt, ToolsArt } from "./Illustrations";
import { DOCS } from "./site-content";

const STOPS: Array<{ name: string; title: string; description: string; file: string; link: string; art: ReactNode }> = [
  { name: "Threads", title: "One thread per task, in a worktree if you want.", description: "A thread is one conversation with one agent in one project. Give it its own Git worktree and branch so parallel work never shares a checkout. The sidebar shows which threads are working, waiting for you, or done.", file: "organizing-conversations.md", link: "Organizing threads", art: <ThreadsArt /> },
  { name: "Review", title: "See what each turn changed.", description: "Every finished turn saves a checkpoint. Review shows one turn or everything uncommitted, hunk by hunk, with Keep and Reject. Restore puts files or the conversation back to any turn, and Redo undoes it.", file: "review.md", link: "Reviewing changes", art: <ReviewArt /> },
  { name: "Approvals", title: "Approve commands before they run.", description: "A request shows the exact command or file and where it runs. Approve once, or deny and reply with what to do instead. Capsule never turns a one-time answer into a permanent permission.", file: "providers.md", link: "Approvals and permissions", art: <ApprovalArt /> },
  { name: "Tools", title: "Terminal, browser and files beside the chat.", description: "The terminal opens in the thread’s folder. Local addresses in its output open in the built-in browser, file paths open in Files, and ⌘L adds selected output to your message.", file: "projects-and-previews.md", link: "Projects and previews", art: <ToolsArt /> },
  { name: "Compare", title: "Run one prompt on several agents.", description: "Send a task to two to four agents, each in its own worktree. Compare shows time taken and lines changed for each, and you keep the one you want.", file: "best-of-n.md", link: "Comparing agents", art: <CompareArt /> },
];

export function FeatureTour({ showIntroduction = true }: { showIntroduction?: boolean }) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const pill = useRef<HTMLSpanElement>(null);
  const id = useId();
  const stop = STOPS[selected]!;
  function select(index: number, focus = false) {
    setSelected(index);
    if (focus) tabs.current[index]?.focus();
  }
  /* The highlight slides from the old tab to the new one; it is measured, not guessed. */
  useLayoutEffect(() => {
    const place = () => {
      const tab = tabs.current[selected];
      const indicator = pill.current;
      if (!tab || !indicator) return;
      indicator.style.width = `${tab.offsetWidth}px`;
      indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
      // Placed without motion the first time; it slides only between tabs.
      if (indicator.dataset.ready === undefined) requestAnimationFrame(() => { indicator.dataset.ready = ""; });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [selected]);
  return <section className="site-section site-tour" aria-labelledby={`${id}-title`}>
    {showIntroduction ? <div className="site-section-head"><p className="site-eyebrow">In the app</p><h2 id={`${id}-title`}>What Capsule does</h2></div> : <h2 id={`${id}-title`} className="sr-only">What Capsule does</h2>}
    <div className="site-tour-tabs" role="tablist" aria-label="Capsule features">
      <span className="site-tour-pill" ref={pill} aria-hidden="true" />
      {STOPS.map((item, index) => <button type="button" role="tab" key={item.name} id={`${id}-tab-${index}`} aria-controls={`${id}-panel`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} ref={(element) => { tabs.current[index] = element; }} onClick={() => select(index)} onKeyDown={(event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % STOPS.length : event.key === "ArrowLeft" ? (index + STOPS.length - 1) % STOPS.length : event.key === "Home" ? 0 : event.key === "End" ? STOPS.length - 1 : undefined;
        if (next !== undefined) { event.preventDefault(); select(next, true); }
      }}>{item.name}</button>)}
    </div>
    <div className="site-tour-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>
      <div className="site-tour-copy" key={`copy-${selected}`}><h3>{stop.title}</h3><p>{stop.description}</p><a className="site-text-link" href={`${DOCS}/${stop.file}`}>{stop.link}<Arrow external /></a></div>
      <div className="site-tour-art" key={`art-${selected}`}>{stop.art}</div>
    </div>
  </section>;
}

const FEATURES = [
  { title: "Settings files", text: "Preferences live in ~/.capsule/settings.json and in a project file your team can commit. Edits apply without a restart.", file: "settings-files.md" },
  { title: "Commands and hooks", text: "Write a slash command or a hook once. Capsule runs it itself, so it works the same with every agent.", file: "commands.md" },
  { title: "Automations", text: "Send a prompt on a schedule. Each run starts a thread that waits for you as unread.", file: "automations.md" },
  { title: "Board", text: "See threads as cards in Draft, Queued, Running, Needs you, Review and Done columns.", file: "board.md" },
  { title: "Other devices", text: "Pair a phone or another computer’s browser to follow a run. It is read-only unless you grant control.", file: "reading-from-another-device.md" },
  { title: "Export", text: "Save any thread as Markdown for an issue, a pull request or your notes.", file: "exporting-conversations.md" },
] as const;

export function FeatureGrid() {
  return <section className="site-section" aria-labelledby="site-features-title">
    <div className="site-section-head"><p className="site-eyebrow">Also in Capsule</p><h2 id="site-features-title">The rest of the workspace</h2></div>
    <div className="site-feature-grid">{FEATURES.map((feature) => <a key={feature.title} href={`${DOCS}/${feature.file}`} className="site-feature-card"><h3>{feature.title}<Arrow external /></h3><p>{feature.text}</p></a>)}</div>
  </section>;
}
