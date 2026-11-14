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

    window.testWorkspace = { ...workspace, api: { ...api, isDesktop: false } };
    root.render(<ReviewDiff key="viewer" projectId="review-fixture" sessionId="review-thread" thread="review-thread" selection={{ kind: "uncommitted" }} ignoreWhitespace={false} onShowAll={() => {}} />);
    await until(() => document.querySelector(".review-diff .file-diff") && !document.querySelector(".hunk-action"));
    assert(heads().length === 0, "A read-only viewer can focus hunk actions");

    window.testWorkspace = workspace;
    root.render(<ReviewDiff key="turn" projectId="review-fixture" sessionId="review-thread" thread="review-thread" selection={{ kind: "turn" }} ignoreWhitespace={false} onShowAll={() => {}} />);
    await until(() => document.querySelector(".review-diff")?.textContent?.includes("No turn in this conversation has saved changes yet."));

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
