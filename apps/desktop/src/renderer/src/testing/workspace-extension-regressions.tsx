import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Run } from "@capsule/shared";
import { ImagePreview } from "../features/shell/ImagePreview";
import { ThreadAgents } from "../features/shell/ThreadAgents";
import { Composer } from "../features/conversation/Composer";
import { Inspector } from "../features/shell/Inspector";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Extension regression did not settle: ${check}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function button(text: string) { return Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === text)!; }
function changeSelect(selector: string, value: string) {
  const select = document.querySelector<HTMLSelectElement>(selector)!;
  select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
}
function PasteFixture({ base }: { base: Record<string, unknown> }) {
  const [draft, setDraft] = useState("Keep selection here");
  const [agentCommandsOpen, setAgentCommandsOpen] = useState(false);
  window.testWorkspace = { ...base, draft, setDraft, agentCommandsOpen, setAgentCommandsOpen };
  return <Composer />;
}

export async function runWorkspaceExtensionRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const root = createRoot(host);
  const originalApi = window.capsule;
  window.capsule = base.api as typeof window.capsule;
  try {
    const canvas = document.createElement("canvas"); canvas.width = 2400; canvas.height = 1600;
    canvas.getContext("2d")!.fillRect(0, 0, 2400, 1600);
    root.render(<ImagePreview src={canvas.toDataURL()} name="large.png" />);
    await until(() => document.querySelector('[aria-label="Inspect image large.png"]'));
    document.querySelector<HTMLButtonElement>('[aria-label="Inspect image large.png"]')!.click();
    await until(() => document.querySelector<HTMLDialogElement>(".image-inspector")?.open);
    const viewport = document.querySelector<HTMLDivElement>(".image-inspector-viewport")!;
    const image = viewport.querySelector("img")!;
    await until(() => image.naturalWidth === 2400);
    assert(image.getBoundingClientRect().width <= viewport.clientWidth, "Fit image exceeds its viewport");
    button("100%").click();
    await until(() => image.getBoundingClientRect().width === 2400);
    viewport.focus(); viewport.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    await until(() => viewport.scrollLeft > 0);
    button("Fit").click(); await until(() => viewport.dataset.fit === "true");
    button("Close").click(); await until(() => !document.querySelector<HTMLDialogElement>(".image-inspector")?.open);
    await until(() => document.activeElement?.getAttribute("aria-label") === "Inspect image large.png");

    let finishPaste!: (value: boolean) => void;
    let pasted = "";
    const pasteSession = { id: "paste", harnessId: "codex", harnessState: "waiting", openclawSessionKey: "direct:acp:codex:paste" };
    const composerBase = { ...base, agentId: "codex", activeRun: undefined, session: pasteSession,
      harnessStatuses: { paste: { session: pasteSession, parsed: { reported: { embeddedContext: true, configOptions: [] }, availableCommands: [{ name: "compact", description: "Compact context" }] } } },
      attachPastedText: async (text: string) => { pasted = text; return new Promise<boolean>((resolve) => { finishPaste = resolve; }); },
    };
    root.render(<PasteFixture base={composerBase} />);
    await until(() => document.querySelector('textarea[aria-label="Message"]'));
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
    const paste = () => {
      const data = new DataTransfer(); data.setData("text/plain", "Large paste\n".repeat(4000));
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      textarea.dispatchEvent(event); return event;
    };
    textarea.focus(); textarea.setSelectionRange(5, 14);
    assert(paste().defaultPrevented, "Supported large paste stayed inline");
    await until(() => pasted.length > 32000);
    assert(textarea.value === "Keep selection here", "Paste removed the selection before attachment admission");
    finishPaste(true);
    await until(() => textarea.value === "Keep  here" && textarea.selectionStart === 5);
    pasted = "";
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "v", metaKey: true, shiftKey: true, bubbles: true }));
    assert(!paste().defaultPrevented && !pasted, "Explicit inline paste was converted");
    root.render(<PasteFixture base={{ ...composerBase, harnessStatuses: {} }} />);
    await until(() => Object.keys(window.testWorkspace.harnessStatuses as object).length === 0);
    assert(!paste().defaultPrevented && !pasted, "Unsupported agent received a text resource");

    let commandSent = "";
    const commandBase = { ...composerBase, runAgentCommand: async (name: string, input: string) => { commandSent = `${name}:${input}`; return true; } };
    const commandState = (names: string[]) => ({ paste: { session: pasteSession, parsed: { reported: { embeddedContext: true, configOptions: [] },
      availableCommands: names.map((name) => ({ name, description: `Run ${name}`, inputHint: "Optional input" })),
    } } });
    root.render(<PasteFixture base={{ ...commandBase, harnessStatuses: commandState(["compact", "review"]) }} />);
    await until(() => document.querySelector('[aria-label="Conversation tools"]'));
    document.querySelector<HTMLElement>('[aria-label="Conversation tools"]')!.click();
    await until(() => document.querySelector('[role="listbox"]'));
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((item) => item.textContent?.includes("Agent commands"))!.click();
    await until(() => document.querySelector<HTMLDetailsElement>(".agent-command-control")?.open);
    changeSelect('[aria-label="Select agent command"]', "review");
    await until(() => document.querySelector<HTMLSelectElement>('[aria-label="Select agent command"]')?.value === "review");
    const commandInput = document.querySelector<HTMLInputElement>('[aria-label="Command input"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(commandInput, "Do not lend this to compact");
    commandInput.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => commandInput.value.includes("Do not lend"));
    root.render(<PasteFixture base={{ ...commandBase, harnessStatuses: commandState(["compact"]) }} />);
    await until(() => commandInput.value === "");
    button("Run command").click();
    await until(() => commandSent === "compact:" && !document.querySelector<HTMLDetailsElement>(".agent-command-control")?.open);
    assert(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.value === "Keep  here", "Command control consumed the prompt draft");
    assert(!document.querySelector('[aria-label="Add context"], .composer-stash-button'), "Secondary controls still crowd the main composer row");
    assert(document.querySelector('[aria-label="Attach files"]') && document.querySelector('[aria-label="Send message"]'), "Composer hid a primary action");
    document.querySelector<HTMLElement>('[aria-label="Conversation tools"]')!.click();
    await until(() => document.querySelector('[role="listbox"]'));
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((item) => item.textContent?.includes("Agent commands"))!.click();
    await until(() => document.querySelector('.agent-command-popover'));
    const commandPanel = document.querySelector<HTMLElement>('.agent-command-popover')!;
    await until(() => getComputedStyle(commandPanel).visibility === "visible");
    const bounds = commandPanel.getBoundingClientRect();
    assert(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, "Command panel escaped the viewport");
    commandPanel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await until(() => !document.querySelector('.agent-command-popover'));
    assert(document.activeElement?.getAttribute("aria-label") === "Conversation tools", "Command Escape did not restore its visible trigger");

    const latest = { id: "latest", sessionId: "history-thread", projectId: "history-project", status: "completed", agentId: "codex", prompt: "Latest" } as Run;
    const old = { ...latest, id: "old", prompt: "Earlier review" };
    let read = 0, resolveOld!: (value: unknown) => void;
    const historyBase = { ...base, projectId: latest.projectId, session: { id: latest.sessionId }, activeRun: undefined,
      runs: [latest, old], events: [], api: { listRunEventPage: async () => { read++; return new Promise((resolve) => { resolveOld = resolve; }); } } };
    window.testWorkspace = historyBase;
    root.render(<ThreadAgents />);
    await until(() => document.querySelector('[aria-label="Agent activity turn"]'));
    assert(read === 0, "Collapsed history triggered an eager scan");
    changeSelect('[aria-label="Agent activity turn"]', "old");
    await until(() => read === 1 && document.body.textContent?.includes("Loading activity"));
    resolveOld({ hasMore: true, events: [{ id: "delegation", runId: old.id, sessionId: old.sessionId, type: "tool", data: {
      toolCallId: "child", status: "in_progress", delegation: { title: "Recorded review", role: "reviewer" },
    } }] });
    await until(() => document.querySelector('[aria-label="Delegated task"]')?.textContent?.includes("Recorded review"));
    assert(document.body.textContent?.includes("Last reported") && document.body.textContent?.includes("partial task list"), "Historical child status or retention was overstated");
    changeSelect('[aria-label="Agent activity turn"]', "latest");
    await until(() => !document.querySelector('[aria-label="Delegated task"]'));
    changeSelect('[aria-label="Agent activity turn"]', "old");
    await until(() => read === 2);
    window.testWorkspace = { ...historyBase, session: { id: "another-thread" } };
    root.render(<ThreadAgents />);
    await until(() => !document.querySelector('[aria-label="Agent activity turn"]'));
    resolveOld({ hasMore: false, events: [{ id: "foreign", runId: old.id, type: "tool", data: { toolCallId: "foreign", delegation: { title: "Stale child" } } }] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert(!document.body.textContent?.includes("Stale child"), "Historical completion crossed threads");

    let draft = "Unfinished implementation notes";
    const pr = { number: 42, title: "Review fixture", url: "https://example.test/pull/42", state: "OPEN", isDraft: false };
    window.testWorkspace = { ...base, inspectorTab: "changes", git: { isRepo: true, branch: "fixture", files: [] },
      setDraft: (update: string | ((value: string) => string)) => { draft = typeof update === "function" ? update(draft) : update; },
      api: { ...(base.api as object), listPullRequests: async () => ({ items: [pr] }), getPullRequest: async () => undefined } };
    root.render(<Inspector />);
    await until(() => document.querySelector(".codex-pr-row"));
    document.querySelector<HTMLButtonElement>(".codex-pr-row")!.click();
    await until(() => document.querySelector('[aria-label="More pull request options"]'));
    document.querySelector<HTMLButtonElement>('[aria-label="More pull request options"]')!.click();
    await until(() => button("Explain this PR"));
    button("Explain this PR").click();
    assert(draft.startsWith("Unfinished implementation notes\n\n") && draft.includes("Please explain PR #42"), "PR action replaced the existing draft");

    // A slow stack action must refresh the PR now being reviewed, not switch
    // back to its original selection and discard the new review draft.
    let finishMerge!: (value: boolean) => void;
    let confirmation: { onConfirm(): void } | undefined;
    const other = { ...pr, number: 43, title: "Next layer", url: "https://example.test/pull/43" };
    const stack = { number: 1, base: "main", layers: [pr, other].map((item) => ({
      number: item.number, title: item.title, state: "open" as const,
      headBranch: "layer-" + item.number, headSha: String(item.number).repeat(20),
    })) };
    let detailReads = 0;
    window.testWorkspace = { ...window.testWorkspace,
      setConfirm: (value: typeof confirmation) => { confirmation = value; },
      gitMergePullRequestStack: () => new Promise<boolean>((resolve) => { finishMerge = resolve; }),
      api: { ...(base.api as object), listPullRequests: async () => ({ items: [pr, other] }),
        getPullRequest: async (_project: string, number: number) => {
          detailReads++;
          return { ...(number === 42 ? pr : other), stackDetail: stack,
            body: "Fixture", labels: [], checkRuns: [], activity: [], commits: [], reviewers: [], files: [], diff: "", additions: 0, deletions: 0 };
        } },
    };
    root.render(<Inspector />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    document.querySelector<HTMLButtonElement>('[aria-label="Retry loading pull request"], [aria-label="Refresh pull request"]')!.click();
    await until(() => button("Merge stack"));
    button("Merge stack").click();
    await until(() => confirmation);
    confirmation!.onConfirm();
    await until(() => finishMerge);
    Array.from(document.querySelectorAll<HTMLButtonElement>(".pr-stack-layer")).find((item) => item.textContent?.includes("#43"))!.click();
    await until(() => document.querySelector('.pr-stack-layer[aria-current="page"]')?.textContent?.includes("#43"));
    const comment = document.querySelector<HTMLTextAreaElement>('[aria-label="Comment draft for the thread"]')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(comment, "Keep this new review draft");
    comment.dispatchEvent(new Event("input", { bubbles: true }));
    const beforeRefresh = detailReads;
    finishMerge(false); // Partial failure must also refresh current state.
    await until(() => detailReads > beforeRefresh);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(document.querySelector('.pr-stack-layer[aria-current="page"]')?.textContent?.includes("#43"), "Stack completion reselected the original PR");
    assert(document.querySelector<HTMLTextAreaElement>('[aria-label="Comment draft for the thread"]')?.value === "Keep this new review draft", "Stack refresh discarded another PR's draft");
  } finally { root.unmount(); window.capsule = originalApi; }
}
