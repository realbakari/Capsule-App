import { createRoot } from "react-dom/client";
import type { HunkApply } from "@capsule/shared";
import { ReviewDiff } from "../features/review/ReviewDiff";
import { SavedTurnDiff } from "../features/conversation/SavedTurnDiff";
import { Palette } from "../features/shell/Palette";
import { reviewScope, setReviewScope } from "../lib/review-scope";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Review hunk regression did not settle: ${check}\n${document.body.textContent?.slice(0, 1200)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const head = "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n";
const stagedHunk = "@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n";
const unstagedHunk = "@@ -20,3 +20,4 @@\n twenty\n twenty-one\n+inserted\n twenty-two\n";
const PATCHES = { uncommitted: head + stagedHunk + unstagedHunk, staged: head + stagedHunk, unstaged: head + unstagedHunk };

function press(target: Element, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}
const heads = () => Array.from(document.querySelectorAll<HTMLElement>(".review-diff [data-hunk]"));

/** Hunk controls in the real component and CSS, against a synthetic two-hunk file. */
export async function runReviewHunkRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const styles = document.querySelector<HTMLStyleElement>("#composer-test-styles")!;
  const previousMedia = styles.media;
  styles.media = "all";
  const previousHost = host.style.cssText;
  host.style.cssText = "width:340px;display:block;position:relative";
  const root = createRoot(host);
  const applied: HunkApply[] = [];
  let refuse: string | undefined;
  let reads = 0;
  const api = { ...(base.api as object), isDesktop: true,
    gitScopedDiff: async (_project: string, scope: keyof typeof PATCHES) => { reads++; return { patch: PATCHES[scope] }; } };
  const workspace = { ...base, api, runs: [], git: { files: [] }, setConfirm: () => {},
    gitApplyHunk: async (apply: HunkApply) => { if (refuse) throw new Error(refuse); applied.push(apply); } };
  try {
    window.testWorkspace = workspace;
    root.render(<ReviewDiff projectId="review-fixture" sessionId="review-thread" thread="review-thread" selection={{ kind: "uncommitted" }} ignoreWhitespace={false} onShowAll={() => {}} />);
    await until(() => heads().length === 2);
    assert(document.querySelector(".review-diff-stat")?.textContent?.replace(/\s+/g, " ").trim() === "1 file +2 −1", "Review does not total what the scope changed");
    assert(document.querySelector(".review-diff .file-diff-body.is-unified"), "A 340px panel opened side by side");
    assert(document.querySelector(".review-diff .file-diff-head .file-type-icon"), "A diff file header lost its type icon");
    const [staged, unstaged] = heads() as [HTMLElement, HTMLElement];
    assert(staged.textContent?.includes("Staged") && staged.textContent.includes("Unstage") && !staged.textContent.includes("Keep"), "A staged hunk offers Keep or hides its state");
    assert(unstaged.textContent?.includes("Keep") && unstaged.textContent.includes("Reject"), "An unstaged hunk lacks Keep or Reject");
    assert(document.querySelector(".file-diff-tools")?.textContent?.includes("Reject all"), "A two-hunk file has no file-wide actions");
    for (const row of heads()) {
      const tools = row.querySelector(".hunk-tools")!.getBoundingClientRect();
      assert(tools.right <= host.getBoundingClientRect().right + 0.5, "Hunk controls overflow a 340px panel");
    }

    unstaged.focus();
    press(unstaged, "j");
    assert(document.activeElement === unstaged, "j moved past the last hunk");
    press(unstaged, "ArrowUp");
    assert(document.activeElement === staged, "ArrowUp did not move to the previous hunk");
    press(staged, "j");
    assert(document.activeElement === unstaged, "j did not move to the next hunk");

    const before = reads;
    press(unstaged, "k");
    await until(() => applied.length === 1 && reads > before);
    assert(applied[0]!.index && !applied[0]!.index.reverse && applied[0]!.index.patch.includes("+inserted") && !applied[0]!.worktree, "k did not stage only the unstaged hunk");

    refuse = "patch failed: app.ts:20\npatch does not apply";
    const afterKeep = reads;
    heads()[1]!.focus();
    press(heads()[1]!, "x");
    await until(() => document.querySelector(".hunk-error"));
    assert(document.querySelector(".hunk-error")?.textContent?.includes("patch does not apply"), "A refused hunk does not show git's reason");
    assert(heads()[1]!.contains(document.querySelector(".hunk-error")), "The refusal is not shown on the hunk that failed");
    assert(reads === afterKeep && applied.length === 1, "A refused action reloaded or applied anyway");

    const viewButton = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>(".review-diff-view button")).find((item) => item.textContent === label)!;
    viewButton("Split").click();
    await until(() => document.querySelector(".review-diff .file-diff-body.is-split"));
    assert(heads().length === 2 && viewButton("Split").getAttribute("aria-pressed") === "true", "Split lost the hunk controls or its pressed state");
    viewButton("Wrap").click();
    await until(() => document.querySelector(".review-diff .file-diff-body.is-scrollable"));
    viewButton("Unified").click();
    await until(() => document.querySelector(".review-diff .file-diff-body.is-unified"));

    window.testWorkspace = { ...workspace, api: { ...api, gitScopedDiff: async () => { throw new Error("Error invoking remote method 'capsule:gitScopedDiff': Error: `git diff` took longer than 30 seconds and was stopped."); } } };
    root.render(<ReviewDiff key="failing" projectId="review-fixture" sessionId="review-thread" thread="review-thread" selection={{ kind: "uncommitted" }} ignoreWhitespace={false} onShowAll={() => {}} />);
    await until(() => document.querySelector(".review-diff-error"));
    assert(document.querySelector(".review-diff-error p")?.textContent === "`git diff` took longer than 30 seconds and was stopped.", "Review's error kept the IPC wrapper");
    assert(document.querySelector(".review-diff-error button")?.textContent === "Try again", "Review's error offers no way to retry");

    window.testWorkspace = { ...workspace, api: { ...api, isDesktop: false } };
    root.render(<ReviewDiff key="viewer" projectId="review-fixture" sessionId="review-thread" thread="review-thread" selection={{ kind: "uncommitted" }} ignoreWhitespace={false} onShowAll={() => {}} />);
    await until(() => document.querySelector(".review-diff .file-diff") && !document.querySelector(".hunk-action"));
    assert(heads().length === 0, "A read-only viewer can focus hunk actions");

    window.testWorkspace = workspace;
    root.render(<ReviewDiff key="turn" projectId="review-fixture" sessionId="review-thread" thread="review-thread" selection={{ kind: "turn" }} ignoreWhitespace={false} onShowAll={() => {}} />);
    await until(() => document.querySelector(".review-diff")?.textContent?.includes("No turn in this conversation has saved changes yet."));
    assert(!document.querySelector(".review-diff")?.textContent?.includes("Keep and Reject work on"), "A turn repeats the read-only note its banner already gives");

    // The latest turn: Reject only where git says the hunk still reverses cleanly.
    const turnPatch = head + stagedHunk + unstagedHunk;
    let checks = 0;
    window.testWorkspace = { ...workspace, projectId: "review-fixture", session: { id: "review-thread" },
      api: { ...api, gitCheckHunks: async (_project: string, applies: HunkApply[]) => { checks++; return applies.map((_, index) => index === 0 && !applied.some((item) => item.worktree)); } } };
    refuse = undefined;
    root.render(<SavedTurnDiff runId="turn-fixture" initialPatch={turnPatch} rejectable />);
    await until(() => document.querySelectorAll(".hunk-action--reject").length === 1);
    assert(!document.querySelectorAll("[data-hunk]")[1]?.querySelector(".hunk-action"), "A hunk that no longer applies offers Reject");
    document.querySelector<HTMLButtonElement>(".hunk-action--reject")!.click();
    await until(() => document.querySelector("[data-hunk]")?.textContent?.includes("Rejected") && checks >= 2);
    const rejected = applied.at(-1)!;
    assert(rejected.worktree?.reverse && rejected.worktree.patch.includes("+TWO") && !rejected.index, "Turn Reject did not reverse only that hunk in the working tree");
    root.render(<SavedTurnDiff key="older" runId="turn-fixture" initialPatch={turnPatch} rejectable={false} />);
    await until(() => document.querySelector(".file-diff") && !document.querySelector(".hunk-action"));

    // A large change: what fits shows, the rest is listed with a way to see each file.
    const testHead = "diff --git a/app.test.ts b/app.test.ts\n--- a/app.test.ts\n+++ b/app.test.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const binary = "diff --git a/image.png b/image.png\nnew file mode 100644\nindex 0000000..1234567\nBinary files /dev/null and b/image.png differ\n";
    const shownFiles: string[] = [];
    const opens: unknown[][] = [];
    const copied: string[] = [];
    let draft = "draft so far";
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
    window.testWorkspace = { ...workspace, project: { id: "review-fixture", workingDirectory: "/fixture/repo" }, session: { id: "review-thread" }, settings: {},
      setNotice: (message: string) => { throw new Error(`Unexpected notice: ${message}`); },
      setDraft: (value: string | ((current: string) => string)) => { draft = typeof value === "function" ? value(draft) : value; },
      api: { ...api, openInApp: async (...args: unknown[]) => { opens.push(args); },
        gitScopedDiff: async (_project: string, scope: keyof typeof PATCHES) => ({ patch: (scope === "uncommitted" ? PATCHES.uncommitted + testHead + binary : PATCHES[scope]),
          omitted: scope === "uncommitted" ? [{ path: "big.log", reason: "too-large", bytes: 2 * 1024 * 1024 }, ...Array.from({ length: 22 }, (_, index) => ({ path: `gen/${index}.ts`, reason: "limit" }))] : undefined }) } };
    root.render(<ReviewDiff key="large" projectId="review-fixture" sessionId="review-thread" thread="review-large" selection={{ kind: "uncommitted" }} ignoreWhitespace={false} onShowAll={() => {}} onShowFile={(file) => shownFiles.push(file)} />);
    await until(() => document.querySelector(".review-omitted"));
    const omittedBox = document.querySelector<HTMLElement>(".review-omitted")!;
    assert(omittedBox.querySelector(".review-omitted-head")?.textContent === "23 files not shown", "The omitted files are not counted");
    assert(omittedBox.textContent?.includes("Too large to show (2.0 MB)"), "A too-large file does not say why it is missing");
    const omittedButton = (label: string) => Array.from(omittedBox.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === label);
    omittedButton("Show")!.click();
    assert(shownFiles[0] === "gen/0.ts", "Show did not read the left-out file on its own");
    assert(omittedButton("3 more files not shown"), "The omitted list is not capped with a count of the rest");
    omittedButton("Open in editor")!.click();
    await until(() => opens.length === 1);
    assert(opens[0]![3] === "/fixture/repo/big.log", "Open in editor did not open the left-out file");
    const imageHead = Array.from(document.querySelectorAll(".review-diff .file-diff-head")).find((item) => item.textContent?.includes("image.png"));
    assert(imageHead?.querySelector(".file-diff-status--binary")?.textContent === "Binary", "A binary file is not marked as one");

    document.querySelector<HTMLButtonElement>('[aria-label="Copy path of app.ts"]')!.click();
    await until(() => copied[0] === "app.ts");
    const headRow = document.querySelector<HTMLElement>(".review-diff .file-diff-head-row")!;
    assert(getComputedStyle(headRow.querySelector(".file-diff-head-actions")!).opacity === "0", "Header actions show before the header is pointed at");
    document.querySelector<HTMLButtonElement>('[aria-label="Open app.ts in editor"]')!.focus();
    await until(() => getComputedStyle(headRow.querySelector(".file-diff-head-actions")!).opacity === "1");

    const hideTests = Array.from(document.querySelectorAll<HTMLButtonElement>(".review-diff-bar button")).find((item) => item.textContent === "Hide tests")!;
    hideTests.click();
    await until(() => !Array.from(document.querySelectorAll(".review-diff .file-diff-head")).some((item) => item.textContent?.includes("app.test.ts")));
    assert(document.querySelector(".review-diff")?.textContent?.includes("1 test file hidden."), "Hidden tests are not counted");
    hideTests.click();
    await until(() => Array.from(document.querySelectorAll(".review-diff .file-diff-head")).some((item) => item.textContent?.includes("app.test.ts")));

    // A note on a line goes to the composer as one block, after it can be edited.
    const inserted = Array.from(document.querySelectorAll<HTMLElement>(".review-diff .diff-row--add")).find((row) => row.textContent?.includes("inserted"))!;
    inserted.querySelector<HTMLButtonElement>(".diff-gutter-add-btn")!.click();
    await until(() => document.querySelector(".review-note-editor textarea"));
    const field = document.querySelector<HTMLTextAreaElement>(".review-note-editor textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Why is this here?");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => !document.querySelector<HTMLButtonElement>(".review-note-editor .send")?.disabled);
    document.querySelector<HTMLButtonElement>(".review-note-editor .send")!.click();
    await until(() => document.querySelector(".review-note p")?.textContent === "Why is this here?");
    const tray = () => document.querySelector<HTMLElement>(".review-notes-tray");
    assert(tray()?.textContent?.includes("1 note"), "The notes tray does not count the note");
    Array.from(document.querySelectorAll<HTMLButtonElement>(".review-note button")).find((item) => item.textContent === "Edit")!.click();
    await until(() => document.querySelector(".review-note-editor textarea"));
    const editField = document.querySelector<HTMLTextAreaElement>(".review-note-editor textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editField, "Why is this line here?");
    editField.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => document.querySelector<HTMLButtonElement>(".review-note-editor .send")?.textContent === "Save" && !document.querySelector<HTMLButtonElement>(".review-note-editor .send")!.disabled);
    document.querySelector<HTMLButtonElement>(".review-note-editor .send")!.click();
    await until(() => document.querySelector(".review-note p")?.textContent === "Why is this line here?");
    Array.from(tray()!.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === "Add to message")!.click();
    await until(() => !tray());
    assert(draft === "draft so far\n\nReview comments:\n- app.ts:22 — Why is this line here?", `The composer got the wrong notes block: ${JSON.stringify(draft)}`);
    assert(!document.querySelector(".review-note"), "Sent notes stayed on their lines");
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard); else delete (navigator as { clipboard?: unknown }).clipboard;
    window.testWorkspace = workspace;

    // Each scope is a palette command that selects it and opens Review.
    let opened: string | undefined;
    window.testWorkspace = { ...workspace, palette: true, paletteQuery: "review", setPaletteQuery: () => {}, setPalette: () => {},
      projects: [], sessions: [], project: { id: "review-fixture", name: "Review fixture" }, session: { id: "review-thread" },
      openInspector: (tab: string) => { opened = tab; }, api: { ...api, search: async () => ({ sessions: [], messages: [] }) } };
    root.render(<Palette />);
    await until(() => document.querySelectorAll('[role="option"]').length >= 5);
    const stagedCommand = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((option) => option.textContent?.includes("Review staged changes"));
    assert(stagedCommand, "The palette has no Review staged changes entry");
    stagedCommand.click();
    await until(() => opened === "changes" && reviewScope("review-fixture") === "staged");
  } finally {
    root.unmount();
    setReviewScope("review-fixture", "uncommitted");
    host.style.cssText = previousHost;
    styles.media = previousMedia;
  }
}
