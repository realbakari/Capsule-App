import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ChatMessage } from "@capsule/shared";
import { Composer } from "../features/conversation/Composer";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown, label: string) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Composer keyboard regression did not settle: ${label}\n${document.body.textContent}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const field = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((item) => item.querySelector(".suggest-name")?.textContent ?? "");

/* Typing as the keyboard does, through the editor, so it lands in the field's undo history. */
function typeKeys(text: string) {
  field().focus();
  assert(document.execCommand("insertText", false, text), "The field refused typed text");
}
function clear() {
  field().focus();
  field().select();
  document.execCommand("delete");
}
function key(name: string, init: KeyboardEventInit = {}) {
  field().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
}

const messages: ChatMessage[] = [
  { id: "k1", sessionId: "context-thread", role: "user", content: "older ask", createdAt: "2026-10-12T00:00:00Z" },
  { id: "k2", sessionId: "context-thread", role: "user", content: "first line\nsecond line\nthird line", createdAt: "2026-10-12T00:00:02Z" },
];

function Fixture({ base }: { base: Record<string, unknown> }) {
  const [draft, setDraft] = useState("");
  window.testWorkspace = { ...base, draft, setDraft };
  return <Composer />;
}

/** The composer's keys: Enter, Escape, the arrows, undo after an edit Capsule made, drops, and the menu's roles. */
export async function runComposerKeyboardRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const root = createRoot(host);
  const originalApi = window.capsule;
  const sent: string[] = [];
  const stops: string[] = [];
  /* Read through a call: assert() narrows a bare `stops.length` to the literal it last checked. */
  const stopCount = () => stops.length;
  const api = { ...(base.api as object), isDesktop: true };
  window.capsule = { ...api, homeDir: "/Users/test" } as unknown as typeof window.capsule;
  const fixture = {
    ...base, api, messages, queue: [], harnesses: [], harnessStatuses: {}, attachments: [], skillId: undefined, setSkillId: () => {},
    settings: { ...(base.settings as object), composerPrompts: [{ name: "Greet", prompt: "Say hello to the team" }] },
    send: async () => { sent.push((window.testWorkspace.draft as string) ?? ""); return true; },
    stopRun: async () => { stops.push("stop"); },
  };
  try {
    root.render(<Fixture base={fixture} />);
    await until(() => field(), "composer mounted");
    const textarea = field();
    assert(textarea.getAttribute("aria-autocomplete") === "list" && textarea.getAttribute("aria-haspopup") === "listbox", "The message field does not say it has a suggestion list");
    assert(textarea.getAttribute("aria-expanded") === "false", "The message field claims an open list with none showing");
    assert(textarea.getAttribute("enterkeyhint") === "send", "Return is not labelled Send on a desktop keyboard");

    typeKeys("/gre");
    await until(() => options().includes("/greet"), "/ lists the saved prompt");
    assert(field().getAttribute("aria-expanded") === "true", "The open / menu is not announced as expanded");
    key("Enter");
    await until(() => field().value === "Say hello to the team", "picking a saved prompt filled the draft");
    assert(document.execCommand("undo"), "Undo was refused after a menu pick");
    await until(() => field().value === "/gre", "⌘Z after a menu pick gives back what was typed");
    clear();
    await until(() => field().value === "", "draft cleared");

    // A pasted path is not a command, and Enter with nothing to pick sends.
    typeKeys("/Users/me/app.log");
    await pause();
    assert(!document.querySelector(".suggest-menu"), "A pasted path opened the / menu");
    clear();
    typeKeys("/nothing-matches-this");
    await until(() => document.querySelector(".suggest-empty"), "an empty / menu says so");
    key("Enter");
    await until(() => sent.includes("/nothing-matches-this"), "Enter sends when the open menu has nothing to pick");
    clear();
    typeKeys("costs $5");
    await pause();
    assert(!document.querySelector(".suggest-menu"), "An amount of money opened the skill menu");
    clear();
    await until(() => field().value === "", "draft cleared");

    // History: the arrows step only from the first line (up) or the last (down) of a recalled prompt.
    key("ArrowUp");
    await until(() => field().value === "first line\nsecond line\nthird line", "ArrowUp recalls the last prompt");
    field().setSelectionRange(field().value.length, field().value.length);
    key("ArrowUp");
    await pause();
    assert(field().value.startsWith("first line"), "ArrowUp on the last line of a recalled prompt stepped history");
    field().setSelectionRange(3, 3);
    key("ArrowUp");
    await until(() => field().value === "older ask", "ArrowUp on the first line steps to the older prompt");
    key("ArrowDown");
    await until(() => field().value.startsWith("first line"), "ArrowDown steps forward");
    field().setSelectionRange(3, 3);
    key("ArrowDown");
    await pause();
    assert(field().value.startsWith("first line"), "ArrowDown on the first line of a recalled prompt stepped history");
    field().setSelectionRange(field().value.length, field().value.length);
    key("ArrowDown");
    await until(() => field().value === "", "ArrowDown on the last line comes back to the draft");
    assert(document.execCommand("undo"), "Undo was refused after a recall");
    await until(() => field().value.startsWith("first line"), "⌘Z after leaving a recalled prompt brings it back");
    clear();
    await until(() => field().value === "", "draft cleared");

    // Text dragged in is the field's to insert; only files are taken as attachments.
    const textDrag = new DataTransfer();
    textDrag.setData("text/plain", "dragged words");
    const over = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: textDrag });
    field().dispatchEvent(over);
    assert(!over.defaultPrevented, "The composer swallowed a text drag");
    assert(!document.querySelector(".composer-glass.dropping"), "A text drag showed the file drop state");
    const drop = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: textDrag });
    field().dispatchEvent(drop);
    assert(!drop.defaultPrevented, "The composer swallowed a text drop");

    // Escape: one that closed something is not followed by a stop; a lone one stops the turn.
    window.testWorkspace = { ...window.testWorkspace };
    root.render(<Fixture base={{ ...fixture, activeRun: { id: "run-k", status: "running" } }} />);
    await until(() => document.querySelector('[aria-label="Stop"]'), "running composer");
    typeKeys("/");
    await until(() => document.querySelector(".suggest-menu"), "menu open during a turn");
    key("Escape");
    await until(() => !document.querySelector('[role="option"]'), "Escape closed the menu");
    key("Escape");
    await pause();
    assert(stops.length === 0, "A second Escape right after closing the menu stopped the turn");
    clear();
    key("s", { metaKey: true });
    await until(() => document.querySelector('[role="dialog"][aria-label="Stashed prompts"]'), "stash opens");
    await pause(700);
    key("Escape");
    await until(() => !document.querySelector('[role="dialog"][aria-label="Stashed prompts"]'), "Escape closes the stash first");
    assert(stops.length === 0, "Escape stopped the turn instead of closing the stash");
    key("Escape", { repeat: true });
    await pause(700);
    key("Escape", { repeat: true });
    assert(stops.length === 0, "A held Escape stopped the turn");
    key("Escape");
    await until(() => stops.length === 1, "A lone Escape stops the turn");

    // A held queue says why and lets the person send it on; a queued message is edited where it stands.
    const queueCalls: string[] = [];
    root.render(<Fixture base={{ ...fixture, activeRun: undefined, followUpsHeld: "Paused after the turn was stopped.",
      queue: [{ id: "q1", content: "then run the tests", attachments: [], createdAt: "2026-10-12T00:00:03Z" }, { id: "q2", content: "and open a PR", attachments: [], createdAt: "2026-10-12T00:00:04Z" }],
      queuedEdit: { id: "q2" }, releaseQueued: (id?: string) => queueCalls.push(`release:${id ?? "all"}`),
      saveQueuedEdit: async () => { queueCalls.push("save"); return true; }, cancelQueuedEdit: () => queueCalls.push("cancel") }} />);
    await until(() => document.body.textContent?.includes("Paused after the turn was stopped."), "held reason shown");
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === "Resume queue")!.click();
    document.querySelectorAll<HTMLElement>(".queued-prompt")[1]!.querySelector<HTMLButtonElement>("button.queued-prompt-steer")!.click();
    assert(queueCalls.join() === "release:all,release:q2", `Held queue controls dispatched ${queueCalls.join()}`);
    assert(document.querySelector(".composer-queued-edit")?.textContent?.includes("Editing queued message"), "The composer does not say a queued message is being edited");
    assert(document.querySelectorAll<HTMLElement>(".queued-prompt")[1]!.getAttribute("aria-current") === "true", "The row being edited is not marked");
    typeKeys("and open a draft PR");
    const update = document.querySelector<HTMLButtonElement>('button[aria-label="Update queued message"]');
    assert(update && !update.disabled, "The primary button is not Update queued message while editing");
    key("Enter");
    await until(() => queueCalls.includes("save"), "Enter saves the queued edit");
    key("Escape");
    await until(() => queueCalls.includes("cancel"), "Escape cancels the queued edit");
    assert(stopCount() === 1, "Escape during a queued edit stopped something");
    clear();

    // Sending waits for a ! command still running, and says why, rather than leaving its output behind.
    const notices: string[] = [];
    root.render(<Fixture base={{ ...fixture, projectId: "context-project", setNotice: (text?: string) => { if (text) notices.push(text); },
      api: { ...api, runComposerCommand: () => new Promise(() => {}) } }} />);
    await until(() => field() && !document.querySelector('[aria-label="Stop"]'), "idle composer");
    typeKeys("!sleep 60");
    key("Enter");
    await until(() => field().value === "" && document.querySelector(".composer-attachments"), "the command is running");
    typeKeys("use the output");
    const sendButton = document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]');
    assert(sendButton?.disabled && sendButton.title.includes("!sleep 60"), `Send was not held for the running command: ${sendButton?.title}`);
    const before = sent.length;
    key("Enter");
    await until(() => notices.some((text) => text.includes("to finish attaching")), "Enter explains why it did not send");
    assert(sent.length === before, "Enter sent while a command's output was still on its way");
    return "Composer keyboard regressions passed";
  } finally {
    root.unmount();
    window.capsule = originalApi;
  }
}
