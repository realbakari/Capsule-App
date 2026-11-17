import { useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Composer } from "../features/conversation/Composer";
import { ThreadFind } from "../features/conversation/ThreadFind";
import { Conversation } from "../features/conversation/Conversation";
import type { ChatMessage } from "@capsule/shared";
import { KEY_COMMAND_EVENT } from "../lib/keybindings";
import { turnsFromMessages } from "../lib/turns";
import type { FindMatch } from "../features/conversation/thread-find";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${check.toString()}\n${document.body.textContent}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
const click = (label: string) => {
  const node = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label);
  assert(node, `No control called ${label}`);
  node.click();
};

const messages: ChatMessage[] = [
  { id: "m1", sessionId: "thread-q", role: "user", content: "first ask", createdAt: "2026-10-12T00:00:00Z" },
  { id: "m2", sessionId: "thread-q", role: "assistant", content: "the answer", createdAt: "2026-10-12T00:00:01Z" },
  { id: "m3", sessionId: "thread-q", role: "user", content: "second ask", createdAt: "2026-10-12T00:00:02Z" },
];

/* Find over the messages as the transcript mounts them: one row per message, its reply in `.body`. */
function FindFixture({ onReveal, onClose }: { onReveal: (match: FindMatch | undefined) => void; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  return <>
    <ThreadFind turns={turnsFromMessages(messages)} scroller={scroller} onReveal={onReveal} onClose={onClose} />
    <div ref={scroller}>{messages.map((message) => <div key={message.id} data-message-id={message.id}><div className="body"><p className="md-p">{message.content}</p></div></div>)}</div>
  </>;
}

/** The text of each range a find highlight holds. */
function highlighted(name: string): string[] {
  const registry = (CSS as unknown as { highlights: { get(name: string): Iterable<Range> | undefined } }).highlights;
  return Array.from(registry.get(name) ?? [], (range) => range.toString());
}

function ComposerFixture({ base }: { base: Record<string, unknown> }) {
  const [draft, setDraft] = useState("");
  window.testWorkspace = { ...base, draft, setDraft };
  return <Composer />;
}

/* The turn minimap: hidden on a short thread or a narrow pane, lit for the turns on screen, and a click lands a folded, unmounted turn. */
async function runTurnMinimapRegressions(root: Root, host: HTMLElement, workspace: Record<string, unknown>) {
  const styles = document.getElementById("composer-test-styles") as HTMLStyleElement;
  const savedMedia = styles.media;
  styles.media = "all";
  host.style.cssText = "display:flex;width:1000px;height:600px";
  const nav = () => host.querySelector<HTMLElement>('nav[aria-label="Conversation turns"]');
  const ticks = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".turn-minimap-tick"));
  const current = () => ticks().findIndex((tick) => tick.getAttribute("aria-current") === "location");
  const scroller = () => host.querySelector<HTMLElement>(".conversation")!;
  const rowTop = (id: string) => {
    const row = host.querySelector(`[data-virtual-turn="${id}"]`);
    return row ? row.getBoundingClientRect().top - scroller().getBoundingClientRect().top : undefined;
  };
  try {
    window.testWorkspace = workspace;
    root.render(<Conversation />);
    await until(() => host.querySelectorAll("[data-message-id]").length === 3);
    // Rows mount at an estimated height and shrink once measured; judge the settled layout.
    await until(() => scroller().scrollHeight <= scroller().clientHeight + 1 && !nav());
    await settle(); await settle();
    assert(!nav(), "Minimap shown on a thread that does not scroll");

    const long: ChatMessage[] = Array.from({ length: 12 }, (_, index) => [
      { id: `t${index + 1}`, sessionId: "thread-q", role: "user" as const, content: `Prompt number ${index + 1} about the build`, createdAt: `2026-10-12T01:${String(index).padStart(2, "0")}:00Z` },
      { id: `t${index + 1}-reply`, sessionId: "thread-q", role: "assistant" as const, content: `Reply ${index + 1}. ${"The change is in and the checks pass. ".repeat(40)}`, createdAt: `2026-10-12T01:${String(index).padStart(2, "0")}:30Z` },
    ]).flat();
    window.testWorkspace = { ...workspace, messages: long };
    root.render(<Conversation />);
    await until(() => nav() && ticks().length === 12);
    assert(ticks()[1]!.getAttribute("aria-label") === "Turn 2: Prompt number 2 about the build", `Tick label was ${ticks()[1]!.getAttribute("aria-label")}`);
    await until(() => ticks()[11]!.hasAttribute("data-in-view") && current() === 11);
    assert(!ticks()[0]!.hasAttribute("data-in-view"), "An off-screen turn was lit");
    assert(ticks().filter((tick) => tick.tabIndex === 0).length === 1, "Ticks are not one tab stop");

    const rail = host.querySelector(".turn-minimap-rail")!.getBoundingClientRect();
    const view = scroller().getBoundingClientRect();
    const column = host.querySelector(".thread")!.getBoundingClientRect();
    assert(Math.abs((rail.top + rail.bottom) / 2 - (view.top + view.bottom) / 2) <= 2, `Rail not centred on the transcript: ${rail.top}-${rail.bottom} in ${view.top}-${view.bottom}`);
    assert(rail.left >= view.left && rail.right <= column.left, `Rail overlaps the messages: ${rail.left}-${rail.right}, column at ${column.left}`);

    // Hover previews the prompt with its reply; the turn is folded and far above, so the jump unfolds and mounts it.
    assert(!host.querySelector('[data-virtual-turn="t2"]'), "Turn 2 started mounted, so the jump proves nothing about virtualized turns");
    ticks()[1]!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    await until(() => host.querySelector(".turn-minimap-preview")?.textContent?.startsWith("Prompt number 2 about the buildReply 2."));
    ticks()[1]!.click();
    await until(() => host.querySelector('[data-message-id="t2"]') && Math.abs((rowTop("t2") ?? 0) - 48) <= 2 && current() === 1);

    click("Next turn");
    await until(() => Math.abs((rowTop("t3") ?? 0) - 48) <= 2 && current() === 2);
    click("Previous turn");
    await until(() => Math.abs((rowTop("t2") ?? 0) - 48) <= 2 && current() === 1);
    const shortcut = (id: string) => window.dispatchEvent(new CustomEvent(KEY_COMMAND_EVENT, { detail: { id } }));
    shortcut("next-turn");
    await until(() => Math.abs((rowTop("t3") ?? 0) - 48) <= 2 && current() === 2);
    shortcut("previous-turn");
    await until(() => Math.abs((rowTop("t2") ?? 0) - 48) <= 2 && current() === 1);
    const before = scroller().scrollTop;
    nav()!.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
    await until(() => scroller().scrollTop >= before + 100);

    ticks()[current()]!.focus();
    ticks()[current()]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    assert(document.activeElement === ticks()[2], "ArrowDown did not move to the next tick");
    ticks()[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    assert(document.activeElement === ticks()[11], "End did not move to the last tick");

    host.style.width = "500px";
    await until(() => !nav());
    // Without room for the rail, the shortcuts still step from the turn being read.
    const hiddenFrom = scroller().scrollTop;
    shortcut("previous-turn");
    await until(() => scroller().scrollTop < hiddenFrom);
    host.style.width = "1000px";
    await until(() => nav());
  } finally {
    root.render(null); await settle();
    host.style.cssText = "";
    styles.media = savedMedia;
  }
}

/** Twelve long turns: enough to scroll and to virtualize the middle. */
function longThread(): ChatMessage[] {
  return Array.from({ length: 12 }, (_, index) => [
    { id: `t${index + 1}`, sessionId: "thread-q", role: "user" as const, content: `Prompt number ${index + 1} about the build`, createdAt: `2026-10-12T01:${String(index).padStart(2, "0")}:00Z` },
    { id: `t${index + 1}-reply`, sessionId: "thread-q", role: "assistant" as const, content: `Reply ${index + 1}. ${"The change is in and the checks pass. ".repeat(40)}`, createdAt: `2026-10-12T01:${String(index).padStart(2, "0")}:30Z` },
  ]).flat();
}

/*
 * Following and reading: a disclosure keeps its place, a sent prompt rises to
 * the top without leaving a gap once answered, page keys in the composer page
 * the transcript, the pill leaves focus alone, both ends stay mounted, and the
 * live region speaks a finished turn.
 */
async function runTranscriptScrollRegressions(root: Root, host: HTMLElement, workspace: Record<string, unknown>) {
  const styles = document.getElementById("composer-test-styles") as HTMLStyleElement;
  const savedMedia = styles.media;
  styles.media = "all";
  host.style.cssText = "display:flex;flex-direction:column;width:1000px;height:600px";
  const scroller = () => host.querySelector<HTMLElement>(".conversation")!;
  const fromTop = (node: Element) => node.getBoundingClientRect().top - scroller().getBoundingClientRect().top;
  const fromEnd = () => scroller().scrollHeight - scroller().scrollTop - scroller().clientHeight;
  const row = (id: string) => host.querySelector(`[data-virtual-turn="${id}"]`);
  const at = (minute: number, second = 0) => `2026-10-12T02:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`;
  try {
    // The "Worked for" fold sits above a short answer, so opening it at the live end used to pin the end and push it away.
    const worked: ChatMessage[] = [
      ...longThread(),
      { id: "w1", sessionId: "thread-q", role: "user", content: "Tidy the build", runId: "run-w", createdAt: at(0) },
      { id: "w1-note", sessionId: "thread-q", role: "assistant", content: `Progress. ${"Reading the build scripts and their callers. ".repeat(60)}`, runId: "run-w", createdAt: at(0, 10) },
      { id: "w1-reply", sessionId: "thread-q", role: "assistant", content: "Done.", runId: "run-w", createdAt: at(0, 20) },
    ];
    const run = { id: "run-w", sessionId: "thread-q", projectId: "context-project", status: "completed", prompt: "Tidy the build", createdAt: at(0), updatedAt: at(0, 20), completedAt: at(0, 20) };
    window.testWorkspace = { ...workspace, messages: worked, runs: [run] };
    root.render(<Conversation />);
    const toggle = () => host.querySelector<HTMLButtonElement>('[data-virtual-turn="w1"] .turn-work-toggle');
    await until(() => toggle() && fromEnd() < 2);
    await settle();
    assert(row("t1") && row("w1"), "The first or last turn was not mounted while reading the latest");
    const before = fromTop(toggle()!);
    assert(before > 0 && before < scroller().clientHeight, `The fold was not on screen to open: ${before}`);
    toggle()!.click();
    await until(() => host.textContent?.includes("Reading the build scripts"));
    await settle(); await settle();
    assert(Math.abs(fromTop(toggle()!) - before) <= 2, `Opening the fold moved it from ${before} to ${fromTop(toggle()!)}`);
    assert(host.querySelector(".jump-latest"), "Opening a fold kept following the end");

    // PageUp in the composer pages the transcript and leaves the caret in the draft.
    const field = host.querySelector<HTMLTextAreaElement>(".composer-field")!;
    field.focus();
    const page = (key: string) => field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    const top = scroller().scrollTop;
    assert(!page("PageUp"), "PageUp in the composer was not taken for the transcript");
    await until(() => scroller().scrollTop < top - 200);
    assert(document.activeElement === field, "Paging the transcript took focus from the composer");
    assert(field.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", shiftKey: true, bubbles: true, cancelable: true })), "Shift+PageUp was taken from the composer");

    // The pill returns to the end without taking focus from the draft.
    const pill = () => host.querySelector<HTMLButtonElement>(".jump-latest");
    await until(() => pill());
    assert(!pill()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true })), "Pressing the pill would move focus off the composer");
    pill()!.click();
    await until(() => !pill() && fromEnd() < 2);
    assert(document.activeElement === field, "The pill took focus from the composer");
    // Scrolled to the top, the last turn is still there for heading navigation.
    scroller().scrollTop = 0;
    await until(() => pill());
    await settle(); await settle();
    assert(row("t1") && row("w1"), "Scrolling to the top unmounted the last turn");
    pill()!.click();
    await until(() => fromEnd() < 2 && !pill());

    // A prompt sent while following rises to near the top, with its reply to come below it.
    const space = () => host.querySelector<HTMLElement>(".thread-end-space")!;
    const sent: ChatMessage[] = [...worked, { id: "s1", sessionId: "thread-q", role: "user", content: "Now the docs", createdAt: at(1) }];
    window.testWorkspace = { ...workspace, messages: sent, runs: [run] };
    root.render(<Conversation />);
    await until(() => row("s1") && Math.abs(fromTop(row("s1")!) - 48) <= 2 && fromEnd() < 2);
    assert(space().offsetHeight > 100, `No room was made under the sent prompt: ${space().offsetHeight}`);
    // Once answered, the room goes and the thread ends at its reply.
    window.testWorkspace = { ...workspace, messages: [...sent, { id: "s1-reply", sessionId: "thread-q", role: "assistant", content: "Docs updated.", createdAt: at(1, 30) }], runs: [run] };
    root.render(<Conversation />);
    await until(() => host.querySelector('[data-message-id="s1-reply"]') && space().offsetHeight === 0 && fromEnd() < 2);

    // The live region speaks a watched turn's end once, and nothing on first look.
    const region = () => host.querySelector<HTMLElement>("[data-thread-announcer]")!;
    const live = { ...run, id: "run-d", status: "running", createdAt: at(1, 40), completedAt: undefined };
    window.testWorkspace = { ...workspace, messages: sent, runs: [run, live], activeRun: live };
    root.render(<Conversation />);
    await settle();
    assert(region().getAttribute("aria-live") === "polite" && !region().textContent, "The live region spoke without a change");
    window.testWorkspace = { ...workspace, messages: sent, runs: [run, { ...live, status: "completed", completedAt: at(2) }], activeRun: undefined };
    root.render(<Conversation />);
    await until(() => region().textContent === "Reply finished.");
  } finally {
    root.render(null); await settle();
    host.style.cssText = "";
    styles.media = savedMedia;
  }
}

export async function runFollowupRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const previous = window.testWorkspace;
  // The composer reads the preload bridge for the home directory; give it one, as the layout regression does.
  const savedApi = window.capsule;
  window.capsule = { ...(base.api as object), homeDir: "/Users/test", isDesktop: true } as typeof window.capsule;
  const root = createRoot(host);
  const calls: string[] = [];
  const queue = [
    { id: "q1", content: "then run the tests", attachments: [], createdAt: "2026-10-12T00:00:03Z" },
    { id: "q2", content: "and open a PR", attachments: [{ name: "a.png", path: "/tmp/a.png", size: 1 }], createdAt: "2026-10-12T00:00:04Z" },
  ];
  const fixture = {
    ...base, session: { id: "thread-q", projectId: "context-project" }, messages, queue, harnesses: [], harnessStatuses: {},
    removeQueued: (id: string) => calls.push(`remove:${id}`), moveQueued: (id: string, direction: string) => calls.push(`move:${id}:${direction}`),
    editQueued: (id: string) => calls.push(`edit:${id}`), steerQueued: async (id: string) => { calls.push(`steer:${id}`); },
    skillId: undefined, setSkillId: () => {}, attachments: [], activeRun: { id: "run-q", status: "running" }, busy: false, sendBlockReason: undefined,
  };
  try {
    // The queue: counted, ordered, each row with its own controls and no steer when the route cannot.
    root.render(<ComposerFixture base={fixture} />);
    await until(() => host.querySelector('[role="region"][aria-label="2 queued follow-ups"]'));
    assert(!host.querySelector(".queued-prompts")?.textContent?.includes("Sent in order"), "Queue explains itself in a paragraph again");
    assert(host.textContent?.includes("then run the tests") && host.textContent.includes("1 file"), "Queue rows missing text or attachment count");
    assert(!Array.from(host.querySelectorAll("button")).some((node) => node.textContent === "Steer"), "Steer offered without a steerable route");
    const rows = host.querySelectorAll<HTMLElement>(".queued-prompt");
    assert(rows.length === 2, "Expected two queued rows");
    assert(rows[0]!.querySelector<HTMLButtonElement>('[aria-label="Move up"]')?.disabled, "First row could move up");
    rows[0]!.querySelector<HTMLButtonElement>('[aria-label="Move down"]')!.click();
    rows[1]!.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]')!.click();
    rows[1]!.querySelector<HTMLButtonElement>('[aria-label="Remove from queue"]')!.click();
    assert(calls.join() === "move:q1:down,edit:q2,remove:q2", `Queue controls dispatched ${calls.join()}`);

    // ArrowUp recalls earlier prompts newest first; ArrowDown comes back to the draft.
    const field = () => host.querySelector<HTMLTextAreaElement>(".composer-field")!;
    const key = (name: string) => field().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    key("ArrowUp");
    await until(() => field().value === "second ask");
    key("ArrowUp");
    await until(() => field().value === "first ask");
    key("ArrowUp"); await settle();
    assert(field().value === "first ask", "Recall walked past the oldest prompt");
    key("ArrowDown");
    await until(() => field().value === "second ask");
    key("ArrowDown");
    await until(() => field().value === "");
    root.render(null); await settle();

    // Find: counts every occurrence, highlights them with the current one apart, walks them with Enter, and closes on Escape.
    const located: string[] = [];
    let closed = 0;
    window.testWorkspace = { ...window.testWorkspace, hasOlderMessages: false };
    root.render(<FindFixture onReveal={(match) => { if (match) located.push(match.messageId); }} onClose={() => { closed += 1; }} />);
    await until(() => host.querySelector('[aria-label="Find in conversation"]'));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Find in conversation"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(input, "ask");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => host.textContent?.includes("1 of 2"));
    await until(() => located.at(-1) === "m1");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await until(() => host.textContent?.includes("2 of 2") && located.at(-1) === "m3");
    await until(() => highlighted("capsule-find-current").join() === "ask" && highlighted("capsule-find").join() === "ask");
    setValue.call(input, "S");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // "first ask", "the answer", "second ask": every occurrence counts, not every message.
    await until(() => host.textContent?.includes("1 of 5"));
    await until(() => highlighted("capsule-find").length === 4 && highlighted("capsule-find-current").length === 1);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    await until(() => host.textContent?.includes("5 of 5") && located.at(-1) === "m3");
    setValue.call(input, "nothing here");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => host.textContent?.includes("No matches"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert(closed === 1, "Escape did not close find");
    assert(!host.textContent?.includes("Searching loaded messages"), "Find claimed a partial search with every message loaded");
    root.render(null); await settle();
    assert(highlighted("capsule-find").length === 0, "Closing find left its highlights painted");

    // With older pages unloaded, find says it searches only what is loaded and can load more.
    let olderLoads = 0;
    const findWorkspace = window.testWorkspace;
    window.testWorkspace = { ...findWorkspace, hasOlderMessages: true, loadingOlder: false, loadOlderMessages: async () => { olderLoads += 1; } };
    root.render(<FindFixture onReveal={() => {}} onClose={() => {}} />);
    await until(() => host.textContent?.includes("Searching loaded messages"));
    click("Load older");
    await until(() => olderLoads === 1);
    window.testWorkspace = findWorkspace;
    root.render(null); await settle();

    // A paired device that can only read sees the queue and why it waits, but no controls that would change it.
    window.testWorkspace = { ...fixture, api: { ...(base.api as object), isDesktop: false, remoteMode: "read" }, followUpsBlocked: "Codex isn't signed in.", draft: "", setDraft: () => {} };
    root.render(<ComposerFixture base={window.testWorkspace as Record<string, unknown>} />);
    await until(() => host.textContent?.includes("On hold: Codex isn't signed in."));
    assert(host.querySelector<HTMLTextAreaElement>(".composer-field")?.placeholder === "Read only on this device", "Read-only composer did not say why its controls are missing");
    assert(!host.querySelector('.queued-prompt [aria-label="Remove from queue"]') && !host.querySelector('.queued-prompt [aria-label="Move down"]'), "Read-only queue offered write controls");
    window.testWorkspace = findWorkspace;
    root.render(null); await settle();

    // Edit from here: offered on sent prompts only, and the confirm carries the file-restore choice.
    const confirms: Array<{ title: string; secondary?: { label: string } }> = [];
    window.testWorkspace = { ...fixture, activeRun: undefined, runs: [], events: [], steps: [], setConfirm: (value?: { title: string; secondary?: { label: string } }) => { if (value) confirms.push(value); }, threadFind: false, setThreadFind: () => {}, attachFiles: async () => true, loadSession: async () => {} };
    root.render(<Conversation />);
    await until(() => host.querySelectorAll('[aria-label="Edit from here"]').length === 2);
    assert(!host.querySelector('.msg.assistant [aria-label="Edit from here"]'), "Edit from here offered on a reply");
    host.querySelector<HTMLButtonElement>('[aria-label="Edit from here"]')!.click();
    await until(() => confirms.length === 1);
    assert(confirms[0]!.title === "Edit from here?" && confirms[0]!.secondary?.label === "Edit and restore files", "Confirm did not offer the restore-files choice");
    root.render(null); await settle();

    // A limit stop names its reset time and offers Resume at reset and Retry now.
    const scheduled: Array<{ runId: string; prompt: string; at: number }> = [];
    const retried: string[] = [];
    const limitedRun = { id: "run-limit", sessionId: "thread-q", projectId: "context-project", status: "failed", prompt: "second ask", error: "Usage limit reached. Try again in 30 minutes.", createdAt: "2026-10-12T00:00:05Z", updatedAt: "2026-10-12T00:00:06Z", completedAt: "2026-10-12T00:00:06Z" };
    window.testWorkspace = { ...window.testWorkspace, runs: [limitedRun], scheduleResume: (runId: string, prompt: string, at: number) => scheduled.push({ runId, prompt, at }), retryPrompt: (prompt: string) => retried.push(prompt), pendingResume: undefined, cancelResume: () => {} };
    root.render(<Conversation />);
    await until(() => host.textContent?.includes("Usage limit reached."));
    assert(host.textContent?.includes("resets at"), "Limit banner did not name the reset time");
    assert(host.textContent?.includes("Continue with another agent"), "Limit banner did not offer another agent");
    click("Resume at reset");
    await until(() => scheduled.length === 1);
    assert(scheduled[0]!.prompt === "second ask" && scheduled[0]!.at > Date.now() + 25 * 60_000, "Resume was not scheduled for the reset time");
    window.testWorkspace = { ...window.testWorkspace, pendingResume: { sessionId: "thread-q", runId: "run-limit", prompt: "second ask", at: scheduled[0]!.at } };
    root.render(<Conversation />);
    await until(() => host.textContent?.includes("Resuming at"));

    // Every waiting approval gets its own card and answers on its own. Deny and reply denies; an agent-supplied target stays on one line.
    const resolved: string[] = [];
    const firstApproval = { id: "approval-1", runId: "run-limit", agentId: "agent", agentName: "Agent", action: "run a command", target: "pnpm test\nrm -rf /", reason: "Runs the checks", status: "pending", createdAt: "2026-10-12T00:00:07Z" };
    const secondApproval = { ...firstApproval, id: "approval-2", action: "edit files", target: "src/app.ts", reason: "", createdAt: "2026-10-12T00:00:08Z" };
    window.testWorkspace = {
      ...window.testWorkspace, pendingResume: undefined,
      pendingApproval: firstApproval, pendingApprovals: [firstApproval, secondApproval],
      api: { ...(window.testWorkspace?.api as object), resolveApproval: async (id: string, decision: string) => { resolved.push(`${id}:${decision}`); } },
    };
    root.render(<Conversation />);
    await until(() => host.querySelectorAll('[aria-label="Approval required"]').length === 2);
    const cards = Array.from(host.querySelectorAll<HTMLElement>('[aria-label="Approval required"]'));
    assert(cards[0]!.querySelector(".conversation-approval-target")?.textContent === "pnpm test rm -rf /", "Approval target kept its line breaks");
    assert(cards[1]!.textContent?.includes("edit files"), "The second approval did not get its own card");
    Array.from(cards[0]!.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Deny and reply")!.click();
    Array.from(cards[1]!.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Approve once")!.click();
    await until(() => resolved.length === 2);
    assert(resolved.join() === "approval-1:denied,approval-2:approved_once", `Approvals resolved as ${resolved.join()}`);
    root.render(null); await settle();

    await runTurnMinimapRegressions(root, host, { ...fixture, activeRun: undefined, runs: [], events: [], steps: [], threadFind: false, setThreadFind: () => {}, promptJump: false, setPromptJump: () => {}, loadSession: async () => {} });
    await runTranscriptScrollRegressions(root, host, { ...fixture, project: { id: "context-project", name: "Context" }, activeRun: undefined, runs: [], events: [], steps: [], pendingApprovals: [], threadFind: false, setThreadFind: () => {}, promptJump: false, setPromptJump: () => {}, loadSession: async () => {} });
    return "Follow-up regressions passed";
  } finally {
    root.unmount();
    window.testWorkspace = previous;
    window.capsule = savedApi;
  }
}
