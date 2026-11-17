import { createRoot } from "react-dom/client";
import type { GitCommitScope, GitStatus } from "@capsule/shared";
import type { ConfirmState } from "../lib/workspace";
import { CommitControl } from "../features/shell/CommitControl";
import { Palette } from "../features/shell/Palette";
import { OPEN_GIT_MENU_EVENT } from "../lib/git-palette";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function until(check: () => unknown) {
  const end = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`UI did not settle: ${check.toString()}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function typeInto(selector: string, value: string) {
  const field = document.querySelector<HTMLTextAreaElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const menuButton = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>(".commit-menu button")).find((button) => button.textContent?.includes(text));

const base: GitStatus = {
  available: true, isRepo: true, branch: "feature", dirty: true, changed: 3, summary: "",
  files: [{ path: "src/a.ts", code: "M " }, { path: "src/b.ts", code: " M" }, { path: "notes.md", code: "??" }],
  branches: ["main", "feature"], upstream: "origin/feature", pushRemote: "origin", defaultBranch: "main", ahead: 0, behind: 0,
};

/** The header commit menu: staged-only commits, the checklist, Pull, and the default-branch question. */
export async function runCommitControlRegressions(host: HTMLElement) {
  const previous = (window as unknown as { testWorkspace?: Record<string, unknown> }).testWorkspace;
  const calls: Array<[string, ...unknown[]]> = [];
  let confirm: ConfirmState | undefined;
  const workspace = (git: GitStatus) => ({
    api: { isDesktop: true }, git, notice: undefined, project: { id: "p" }, session: { id: "s", title: "Rate limit" },
    settings: { branchPrefix: "capsule" },
    setConfirm: (value?: ConfirmState) => { confirm = value; },
    gitFetch: async () => { calls.push(["fetch"]); },
    gitCommit: async (message: string, scope?: GitCommitScope) => { calls.push(["commit", message, scope]); return true; },
    gitPush: async (options?: { toDefaultBranch?: boolean }) => { calls.push(["push", options?.toDefaultBranch ?? false]); return true; },
    gitPull: async (mode?: string) => { calls.push(["pull", mode]); return true; },
    gitCreateBranch: async (name: string) => { calls.push(["branch", name]); return true; },
    gitCreatePullRequest: async () => { calls.push(["pr"]); return true; },
  });
  const show = async (git: GitStatus) => {
    (window as unknown as { testWorkspace: unknown }).testWorkspace = workspace(git);
    const root = createRoot(host);
    root.render(<CommitControl key={JSON.stringify(git)} />);
    await until(() => host.querySelector(".session-details-action"));
    host.querySelector<HTMLButtonElement>(".session-details-action")!.click();
    await until(() => document.querySelector(".commit-menu"));
    return root;
  };
  try {
    // Something staged: the commit takes the index, and says so.
    let root = await show(base);
    assert(calls.some(([name]) => name === "fetch"), "Opening the menu did not refresh remote refs");
    assert(menuButton("Commit 1 staged file"), "A staged commit does not say it takes only what is staged");
    assert(!document.querySelector(".commit-menu-files"), "The checklist showed while something is staged");
    typeInto(".commit-menu textarea", "Subject\n\nBody");
    await until(() => !menuButton("Commit 1 staged file")?.disabled);
    document.querySelector(".commit-menu textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    await until(() => calls.some(([name]) => name === "commit"));
    const staged = calls.find(([name]) => name === "commit")!;
    assert(staged[1] === "Subject\n\nBody" && JSON.stringify(staged[2]) === JSON.stringify({ staged: true }), `Staged commit sent ${JSON.stringify(staged)}`);
    root.unmount();

    // Nothing staged: every file ticked, untracked apart; unticking leaves it out.
    calls.length = 0;
    root = await show({ ...base, files: [{ path: "src/a.ts", code: " M" }, { path: "notes.md", code: "??" }] });
    const headings = Array.from(document.querySelectorAll(".commit-menu-files h5")).map((node) => node.textContent);
    assert(headings.join() === "Changes,Untracked", `Checklist sections were ${headings.join()}`);
    assert(menuButton("Commit 2 files"), "The checklist commit does not count its files");
    const untracked = Array.from(document.querySelectorAll<HTMLLabelElement>(".commit-menu-file")).find((label) => label.textContent?.includes("notes.md"))!;
    untracked.querySelector("input")!.click();
    await until(() => menuButton("Commit 1 file"));
    typeInto(".commit-menu textarea", "Only a");
    await until(() => !menuButton("Commit 1 file")?.disabled);
    menuButton("Commit 1 file")!.click();
    await until(() => calls.some(([name]) => name === "commit"));
    assert(JSON.stringify(calls.find(([name]) => name === "commit")![2]) === JSON.stringify({ paths: ["src/a.ts"] }), "Unticked file was committed");
    root.unmount();

    // Behind: Pull is offered and Push is held back with the reason.
    calls.length = 0;
    root = await show({ ...base, dirty: false, files: [], behind: 2 });
    assert(menuButton("Pull 2 commits"), "Behind did not offer Pull");
    assert(menuButton("Push")!.disabled && document.body.textContent?.includes("Pull first: origin/feature has 2 commits"), "Push was not held back while behind");
    menuButton("Pull 2 commits")!.click();
    await until(() => calls.some(([name, mode]) => name === "pull" && mode === "ff-only"));
    root.unmount();

    // Diverged: rebase is offered by name.
    calls.length = 0;
    root = await show({ ...base, dirty: false, files: [], ahead: 1, behind: 1 });
    menuButton("Rebase onto origin/feature")!.click();
    await until(() => calls.some(([name, mode]) => name === "pull" && mode === "rebase"));
    root.unmount();

    // Never pushed: Publish, not a disabled Push.
    root = await show({ ...base, dirty: false, files: [], upstream: undefined, ahead: undefined, behind: undefined });
    assert(menuButton("Publish branch") && !menuButton("Publish branch")!.disabled, "A never-pushed branch cannot be published");
    root.unmount();

    // On the default branch, Push asks, and offers a new branch named from the work.
    calls.length = 0;
    root = await show({ ...base, branch: "main", upstream: "origin/main", dirty: false, files: [], ahead: 2 });
    menuButton("Push 2 commits")!.click();
    await until(() => confirm);
    assert(confirm?.title === "Push to main?", `Default-branch push did not ask: ${confirm?.title}`);
    assert(confirm.secondary?.label === "Push to capsule/rate-limit", `New-branch option was ${confirm.secondary?.label}`);
    assert(!calls.some(([name]) => name === "push"), "Pushed before the answer");
    confirm!.secondary!.onConfirm();
    await until(() => calls.some(([name]) => name === "push"));
    assert(JSON.stringify(calls.filter(([name]) => name !== "fetch")) === JSON.stringify([["branch", "capsule/rate-limit"], ["push", false]]), `New-branch push ran ${JSON.stringify(calls)}`);
    root.unmount();
    return "Commit control regressions passed";
  } finally {
    (window as unknown as { testWorkspace?: unknown }).testWorkspace = previous;
  }
}

/** The palette's git rows: present, disabled with a reason when they cannot run, and wired to the same actions. */
export async function runGitPaletteRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const previous = (window as unknown as { testWorkspace?: Record<string, unknown> }).testWorkspace;
  const root = createRoot(host);
  const pulls: string[] = [];
  const menus: string[] = [];
  const onMenu = (event: Event) => menus.push((event as CustomEvent<string>).detail);
  window.addEventListener(OPEN_GIT_MENU_EVENT, onMenu);
  const row = (text: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((node) => node.textContent?.startsWith(text));
  const show = async (patch: Record<string, unknown>) => {
    root.render(null);
    await until(() => !row("Commit…"));
    (window as unknown as { testWorkspace: unknown }).testWorkspace = {
      ...base, palette: true, paletteQuery: ">git", setPalette: () => {}, setPaletteQuery: () => {}, setView: () => {},
      project: { id: "p", name: "Fixture", workingDirectory: "/fixture" }, api: { ...(base.api as object), isDesktop: true },
      gitPull: async (mode: string) => { pulls.push(mode); return true; }, ...patch,
    };
    root.render(<Palette key={JSON.stringify(patch.git ?? null) + String((patch.api as { isDesktop?: boolean } | undefined)?.isDesktop)} />);
    await until(() => row("Commit…"));
  };
  try {
    await show({ git: { ...fixtureGit(), behind: 2, dirty: true, changed: 3 } });
    assert(row("Pull 2 commits")?.getAttribute("aria-disabled") === "false", "Palette did not offer Pull while behind");
    assert(row("Push")?.getAttribute("aria-disabled") === "true" && row("Push")?.textContent?.includes("Pull first"), "Palette Push was not held back while behind");
    row("Pull 2 commits")!.click();
    await until(() => pulls.includes("ff-only"));
    row("Commit…")!.click();
    await until(() => menus.includes("commit"));
    row("Switch branch…")!.click();
    await until(() => menus.includes("branch"));

    await show({ git: { ...fixtureGit(), dirty: false, changed: 0, files: [] } });
    assert(row("Commit…")?.textContent?.includes("Nothing to commit"), "Clean tree did not say why Commit is off");
    assert(row("Push")?.textContent?.includes("Nothing to push"), "Synced branch did not say why Push is off");

    await show({ git: { ...fixtureGit(), upstream: undefined, ahead: undefined, behind: undefined } });
    assert(row("Publish branch")?.getAttribute("aria-disabled") === "false", "Palette could not publish a new branch");

    await show({ git: fixtureGit(), api: { ...(base.api as object), isDesktop: false } });
    assert(row("Commit…")?.textContent?.includes("Available in the desktop app."), "A paired device was offered git writes");
    return "Git palette regressions passed";
  } finally {
    window.removeEventListener(OPEN_GIT_MENU_EVENT, onMenu);
    root.unmount();
    (window as unknown as { testWorkspace?: unknown }).testWorkspace = previous;
  }
}

function fixtureGit(): GitStatus {
  return { ...base, files: [...base.files] };
}
