import type { ReactNode } from "react";
import {
  CheckIcon, ChevronDownIcon, ChevronRightIcon, DiffIcon, FileIcon, FolderIcon, GitBranchIcon,
  GlobeIcon, PanelLeftIcon, PlusIcon, SearchIcon, ShieldIcon, TerminalIcon,
} from "../shell/icons";

/*
 * Product illustrations for the public site.
 *
 * Each one is a crop of Capsule's own interface, drawn in the site's tokens
 * with the app's icons: real words only on what the section is about, quiet
 * bars for everything else, and the window running off an edge rather than
 * floating whole in a box. They are pictures, so each is one labelled image
 * to assistive technology and nothing inside it is focusable.
 */

function Art({ label, className, children }: { label: string; className: string; children: ReactNode }) {
  return <div className={`art ${className}`} role="img" aria-label={label}><div className="art-stage" aria-hidden="true">{children}</div></div>;
}

/** A placeholder line of text, sized in em so it scales with the window. */
function Bar({ w, tone }: { w: string; tone?: "strong" | "faint" }) {
  return <span className={`art-bar${tone ? ` art-bar-${tone}` : ""}`} style={{ width: w }} />;
}

function Titlebar({ children }: { children?: ReactNode }) {
  return <div className="art-titlebar"><span className="art-lights"><i /><i /><i /></span>{children}</div>;
}

function Done() { return <span className="art-state art-state-done"><CheckIcon size={11} /></span>; }

/** The compact hero: one finished turn, its tool steps, and the diff it left. */
export function HeroStill() {
  return <Art className="art-hero" label="A Capsule thread: the request, the steps the agent took, and the one-file diff it produced, ready to review.">
    <div className="art-window">
      <Titlebar><PanelLeftIcon size={13} /><span className="art-crumb"><b>capsule</b><span>Tidy the sidebar row layout</span></span></Titlebar>
      <div className="art-thread">
        <div className="art-prompt">The sidebar cuts thread titles off too early. Can you find out why?</div>
        <ul className="art-steps">
          <li><Done />Read <code>styles.css</code></li>
          <li><Done />Read <code>Sidebar.tsx</code></li>
          <li><Done />Edited <code>styles.css</code></li>
          <li><Done />Ran <code>pnpm test</code></li>
        </ul>
        <div className="art-reply"><Bar w="92%" /><Bar w="78%" /><Bar w="40%" /></div>
        <div className="art-changes">
          <div className="art-changes-head"><DiffIcon size={13} /><span>1 file changed</span><span className="art-add">+12</span><span className="art-del">−5</span><span className="art-button">Review</span></div>
          <pre className="art-diff"><span className="art-del-line">-  grid-template-columns: 2.15rem auto minmax(0, 1fr) auto;</span><span className="art-add-line">+  grid-template-columns: auto minmax(0, 1fr);</span></pre>
        </div>
      </div>
    </div>
  </Art>;
}

/** Threads in the sidebar, one per task, beside the one that is working in its own worktree. */
export function ThreadsArt() {
  return <Art className="art-threads" label="Capsule's sidebar with three threads in one project: one done, one waiting for you, and one working in its own worktree, open beside it.">
    <div className="art-window art-split">
      <div className="art-sidebar">
        <div className="art-side-top"><span className="art-lights"><i /><i /><i /></span></div>
        <div className="art-side-action"><PlusIcon size={13} /><span>New conversation</span></div>
        <div className="art-side-action"><SearchIcon size={13} /><Bar w="40%" tone="faint" /></div>
        <div className="art-side-group"><ChevronDownIcon size={12} /><FolderIcon size={13} /><span>capsule</span></div>
        <div className="art-side-row"><span className="art-row-title">Tidy the sidebar row layout</span><Done /></div>
        <div className="art-side-row is-selected"><span className="art-row-title">Retry failed release uploads</span><span className="art-state art-state-working" /></div>
        <div className="art-side-row"><span className="art-row-title">Fix the flaky checkpoint test</span><span className="art-needs">Needs you</span></div>
        <div className="art-side-row"><Bar w="58%" tone="faint" /></div>
        <div className="art-side-group"><ChevronRightIcon size={12} /><FolderIcon size={13} /><Bar w="34%" tone="faint" /></div>
        <div className="art-side-group"><ChevronRightIcon size={12} /><FolderIcon size={13} /><Bar w="46%" tone="faint" /></div>
      </div>
      <div className="art-main">
        <div className="art-titlebar"><span className="art-crumb"><b>capsule</b><span>Retry failed release uploads</span></span><span className="art-branch"><GitBranchIcon size={11} />task/release-retry</span></div>
        <div className="art-thread">
          <div className="art-prompt art-prompt-bars"><Bar w="15em" tone="strong" /><Bar w="9em" tone="strong" /></div>
          <ul className="art-steps">
            <li><Done />Read <code>upload.ts</code></li>
            <li><Done />Edited <code>upload.ts</code></li>
            <li><span className="art-state art-state-working" /><span className="art-shimmer">Running pnpm test</span></li>
          </ul>
          <div className="art-reply"><Bar w="70%" tone="faint" /><Bar w="48%" tone="faint" /><Bar w="62%" tone="faint" /></div>
        </div>
      </div>
    </div>
  </Art>;
}

/** The Review panel scoped to one turn, with a hunk you can keep or reject. */
export function ReviewArt() {
  return <Art className="art-review" label="The Review panel showing what turn 2 changed in styles.css, with Keep and Reject on the hunk.">
    <div className="art-window">
      <div className="art-panel-head"><span className="art-select">Turn 2 · Tidy the sidebar row…<ChevronDownIcon size={12} /></span><span className="art-head-count"><span className="art-add">+12</span> <span className="art-del">−5</span></span></div>
      <div className="art-files">
        <div className="art-file is-selected"><FileIcon size={12} /><span>styles.css</span><span className="art-file-count"><span className="art-add">+12</span> <span className="art-del">−5</span></span></div>
        <div className="art-file"><FileIcon size={12} /><Bar w="34%" tone="faint" /></div>
      </div>
      <div className="art-hunk">
        <div className="art-hunk-head"><span>@@ -184,7 +184,6 @@ .thread-row</span><span className="art-hunk-actions"><span className="art-button art-button-quiet">Reject</span><span className="art-button">Keep</span></span></div>
        <div className="art-code">
          <div className="art-line"><i>184</i><span><Bar w="46%" /></span></div>
          <div className="art-line"><i>185</i><span><Bar w="30%" /></span></div>
          <div className="art-line is-del"><i>186</i><span>-  grid-template-columns: 2.15rem auto minmax(0, 1fr) auto;</span></div>
          <div className="art-line is-add"><i>186</i><span>+  grid-template-columns: auto minmax(0, 1fr);</span></div>
          <div className="art-line is-add"><i>187</i><span>+  column-gap: 0.5rem;</span></div>
          <div className="art-line"><i>188</i><span><Bar w="38%" /></span></div>
          <div className="art-line"><i>189</i><span><Bar w="22%" /></span></div>
          <div className="art-line"><i>190</i><span><Bar w="52%" /></span></div>
          <div className="art-line"><i>191</i><span><Bar w="34%" /></span></div>
          <div className="art-line"><i>192</i><span><Bar w="12%" /></span></div>
        </div>
      </div>
    </div>
  </Art>;
}

/** An approval request in the thread: the exact command, and what you can answer. */
export function ApprovalArt() {
  return <Art className="art-approval" label="An approval request in a Capsule thread: the agent asks to run pnpm test, with Deny and reply and Approve once.">
    <div className="art-window">
      <div className="art-thread">
        <div className="art-reply"><Bar w="88%" /><Bar w="64%" /></div>
        <div className="art-request">
          <div className="art-request-head"><ShieldIcon size={13} /><span>Codex wants to run a command</span></div>
          <pre className="art-command">pnpm test --filter @capsule/desktop</pre>
          <div className="art-request-meta">in ~/code/capsule</div>
          <div className="art-request-actions"><span className="art-button art-button-quiet">Deny and reply</span><span className="art-button art-button-primary">Approve once</span></div>
        </div>
      </div>
      <div className="art-composer"><Bar w="34%" tone="faint" /><span className="art-send" /></div>
    </div>
  </Art>;
}

/** The terminal drawer: a dev server's address opens in the built-in browser. */
export function ToolsArt() {
  return <Art className="art-tools" label="The terminal drawer under a thread. The dev server's local address is a link that opens in Capsule's browser.">
    <div className="art-window">
      <div className="art-tabs"><span className="is-selected"><TerminalIcon size={12} />zsh</span><span><GlobeIcon size={12} />Browser</span><span><FileIcon size={12} />Files</span></div>
      <div className="art-terminal">
        <div className="art-term-line"><b>$</b> pnpm dev</div>
        <div className="art-term-line"><Bar w="44%" tone="faint" /></div>
        <div className="art-term-line">Server ready in 412 ms</div>
        <div className="art-term-line">➜ Local: <span className="art-link">http://localhost:5173/</span></div>
        <div className="art-hint">Click to open in Browser · ⌘-click for your default browser</div>
        <div className="art-term-line"><Bar w="30%" tone="faint" /></div>
        <div className="art-term-line"><Bar w="52%" tone="faint" /></div>
      </div>
    </div>
  </Art>;
}

/** One prompt on several agents, each in its own worktree, compared when done. */
export function CompareArt() {
  const rows = [
    { name: "Claude Code", state: "Done", time: "4m 12s", files: "3 files", add: "+41", del: "−9", lead: true },
    { name: "Codex", state: "Done", time: "5m 03s", files: "4 files", add: "+58", del: "−22" },
    { name: "Gemini CLI", state: "Working", time: "3m 40s" },
  ];
  return <Art className="art-compare" label="Compare: the same prompt run on Claude Code, Codex and Gemini CLI, with each one's state, time and changed lines.">
    <div className="art-window">
      <div className="art-panel-head"><span>Compare · 3 agents</span></div>
      <div className="art-candidates">{rows.map((row) => <div key={row.name} className={`art-candidate${row.lead ? " is-selected" : ""}`}>
        <div className="art-candidate-name">{row.name}</div>
        <div className="art-candidate-state">{row.state === "Done" ? <><Done />Done</> : <><span className="art-state art-state-working" /><span className="art-shimmer">Working</span></>}<span className="art-time">{row.time}</span></div>
        {row.files ? <div className="art-candidate-diff">{row.files} <span className="art-add">{row.add}</span> <span className="art-del">{row.del}</span></div> : <div className="art-candidate-diff"><Bar w="60%" tone="faint" /></div>}
        {row.lead ? <span className="art-button art-button-primary">Keep this one</span> : null}
      </div>)}</div>
    </div>
  </Art>;
}
