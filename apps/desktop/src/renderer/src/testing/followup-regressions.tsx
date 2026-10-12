import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Composer } from "../features/conversation/Composer";
import { ThreadFind } from "../features/conversation/ThreadFind";
import { Conversation } from "../features/conversation/Conversation";
import type { ChatMessage } from "@capsule/shared";

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

function ComposerFixture({ base }: { base: Record<string, unknown> }) {
  const [draft, setDraft] = useState("");
  window.testWorkspace = { ...base, draft, setDraft };
  return <Composer />;
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
    await until(() => host.textContent?.includes("2 follow-ups queued"));
    assert(host.textContent?.includes("then run the tests") && host.textContent.includes("1 file"), "Queue rows missing text or attachment count");
    assert(!Array.from(host.querySelectorAll("button")).some((node) => node.textContent === "Steer now"), "Steer now offered without a steerable route");
    const rows = host.querySelectorAll<HTMLElement>(".queued-prompt");
    assert(rows.length === 2, "Expected two queued rows");
    assert(rows[0]!.querySelector<HTMLButtonElement>('[aria-label="Move up"]')?.disabled, "First row could move up");
    rows[0]!.querySelector<HTMLButtonElement>('[aria-label="Move down"]')!.click();
    rows[1]!.querySelector<HTMLButtonElement>('[aria-label="Edit in the composer"]')!.click();
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

    // Find: counts matches, walks them with Enter, locates the message, and closes on Escape.
    const located: string[] = [];
    let closed = 0;
    root.render(<ThreadFind messages={messages} onLocate={(id) => located.push(id)} onClose={() => { closed += 1; }} />);
    await until(() => host.querySelector('[aria-label="Find in conversation"]'));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Find in conversation"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(input, "ask");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => host.textContent?.includes("1 of 2"));
    await until(() => located.at(-1) === "m1");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await until(() => host.textContent?.includes("2 of 2") && located.at(-1) === "m3");
    setValue.call(input, "nothing here");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => host.textContent?.includes("No matches"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert(closed === 1, "Escape did not close find");
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
    assert(host.textContent?.includes("lifts at"), "Limit banner did not name the reset time");
    click("Resume at reset");
    await until(() => scheduled.length === 1);
    assert(scheduled[0]!.prompt === "second ask" && scheduled[0]!.at > Date.now() + 25 * 60_000, "Resume was not scheduled for the reset time");
    window.testWorkspace = { ...window.testWorkspace, pendingResume: { sessionId: "thread-q", runId: "run-limit", prompt: "second ask", at: scheduled[0]!.at } };
    root.render(<Conversation />);
    await until(() => host.textContent?.includes("Resuming at"));
    return "Follow-up regressions passed";
  } finally {
    root.unmount();
    window.testWorkspace = previous;
    window.capsule = savedApi;
  }
}
