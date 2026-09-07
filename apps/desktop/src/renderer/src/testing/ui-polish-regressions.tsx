import { createRoot } from "react-dom/client";
import type { GitPullRequest } from "@capsule/shared";
import { PullRequestList } from "../features/shell/PullRequestList";
import { GitPullRequestDetail } from "../features/shell/PullRequestDetail";
import { ReviewCommitForm } from "../features/shell/ReviewCommitForm";
import { HarnessCatalogRow } from "../features/harness/HarnessCatalogRow";

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
function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Exercise the actual components and computed layout, without screenshots or a live profile. */
export async function runUiPolishRegressions(host: HTMLElement) {
  const root = createRoot(host);
  const originalTheme = document.documentElement.getAttribute("data-theme");
  const pullRequest: GitPullRequest = { number: 42, title: "Improve file search", url: "https://example.test/pull/42", state: "OPEN", isDraft: false, author: "contributor" };
  let commits = 0;
  let completeCommit: (value: boolean) => void = () => {};
  const commit = () => { commits++; return new Promise<boolean>((resolve) => { completeCommit = resolve; }); };
  try {
    // The same typography and control geometry must survive both themes and narrow inspectors.
    for (const theme of ["dark", "light"]) {
      document.documentElement.setAttribute("data-theme", theme);
      for (const fontSize of [16, 20]) {
        document.documentElement.style.fontSize = `${fontSize}px`;
        for (const width of [320, 560, 900]) {
          root.render(<div style={{ width }} data-review-fixture>
            <PullRequestList items={[pullRequest]} loading={false} onRefresh={() => {}} onSelect={() => {}} />
            <ReviewCommitForm dirty onCommit={commit} />
          </div>);
          await until(() => document.querySelector<HTMLElement>("[data-review-fixture]")?.style.width === `${width}px`);
          const search = document.querySelector(".pr-search-field")!;
          const sort = document.querySelector(".pr-list-filters select")!;
          assert(Math.abs(search.getBoundingClientRect().height - sort.getBoundingClientRect().height) < 1, "Search and sort heights differ");
          const input = document.querySelector<HTMLInputElement>('[aria-label="Commit message"]')!;
          const submit = document.querySelector<HTMLButtonElement>(".review-commit-button")!;
          assert(Math.abs(input.getBoundingClientRect().height - submit.getBoundingClientRect().height) < 1, "Commit button and input heights differ");
          assert(submit.disabled, "Empty commit is enabled");
          const fixture = document.querySelector<HTMLElement>("[data-review-fixture]")!;
          assert(fixture.scrollWidth <= width + 1, "Review controls overflow their inspector");
          assert(parseFloat(getComputedStyle(search).borderRadius) > 0, "Search retained native input chrome");
          assert(getComputedStyle(document.querySelector(".pr-search-field input")!).backgroundColor === "rgba(0, 0, 0, 0)", "Search field has a second native background");
        }
      }
    }
    fill('[aria-label="Filter pull requests"]', "missing");
    await until(() => document.body.textContent?.includes("No loaded pull requests match"));
    fill('[aria-label="Filter pull requests"]', "42");
    await until(() => document.querySelector(".codex-pr-row"));

    fill('[aria-label="Commit message"]', "Keep this draft");
    await until(() => !document.querySelector<HTMLButtonElement>(".review-commit-button")!.disabled);
    const form = document.querySelector(".commit-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await until(() => document.querySelector('[aria-busy="true"].commit-form'));
    assert(commits === 1, "Duplicate commit submission escaped the busy guard");
    completeCommit(false);
    await until(() => document.querySelector(".review-commit-note[role=alert]"));
    assert(document.querySelector<HTMLInputElement>('[aria-label="Commit message"]')!.value === "Keep this draft", "Failed commit discarded its draft");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await until(() => commits === 2);
    completeCommit(true);
    await until(() => document.querySelector<HTMLInputElement>('[aria-label="Commit message"]')!.value === "");

    // Re-keying a form isolates a late response from the previous workspace.
    root.render(<ReviewCommitForm key="first" dirty onCommit={commit} />);
    await until(() => !document.querySelector("[data-review-fixture]"));
    fill('[aria-label="Commit message"]', "First workspace");
    await until(() => !document.querySelector<HTMLButtonElement>(".review-commit-button")!.disabled);
    document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await until(() => commits === 3);
    root.render(<ReviewCommitForm key="second" dirty onCommit={commit} />);
    await until(() => document.querySelector<HTMLInputElement>('[aria-label="Commit message"]')!.value === "");
    fill('[aria-label="Commit message"]', "Second workspace");
    completeCommit(true);
    await until(() => document.querySelector<HTMLInputElement>('[aria-label="Commit message"]')!.value === "Second workspace");

    let selected = "";
    root.render(<aside className="harness-catalog" style={{ width: 250 }}>
      <HarnessCatalogRow id="claude" name="Claude Code" detail="Ready · project default" selected sessionOpen={false} onSelect={() => { selected = "claude"; }} />
      <HarnessCatalogRow id="codex" name="Codex" detail="Ready" selected={false} sessionOpen={false} onSelect={() => { selected = "codex"; }} />
    </aside>);
    await until(() => document.querySelectorAll(".harness-catalog-row").length === 2);
    const [active, other] = Array.from(document.querySelectorAll<HTMLButtonElement>(".harness-catalog-row"));
    assert(active!.getAttribute("aria-pressed") === "true" && other!.getAttribute("aria-pressed") === "false", "Harness selection is ambiguous");
    assert(active!.querySelector(".harness-catalog-indicators svg") && !other!.querySelector(".harness-catalog-indicators svg"), "Selection check missing or duplicated");
    assert(other!.getBoundingClientRect().top > active!.getBoundingClientRect().bottom, "Harness rows touch each other");
    other!.click();
    assert(selected === "codex", "Harness row failed to select");

    document.documentElement.style.fontSize = "16px";
    root.render(<GitPullRequestDetail summary={pullRequest} loading={false} onRefresh={() => {}}
      onLoadCommitDiff={async () => ""} onBack={() => {}} onOpenBrowser={() => {}} onOpenUrl={() => {}} />);
    await until(() => document.querySelector('[aria-label="More pull request options"]'));
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="More pull request options"]')!;
    trigger.click();
    await until(() => document.querySelector('[role="dialog"][aria-label="Pull request actions"]'));
    const menu = document.querySelector<HTMLElement>(".pr-action-menu")!;
    assert(menu.parentElement === document.body, "PR action menu is still clipped by the inspector");
    assert(menu.querySelectorAll("button > svg").length === 5, "PR menu does not use consistent vector icons");
    assert(!/\p{Extended_Pictographic}/u.test(menu.textContent ?? ""), "PR menu still contains emoji icons");
    assert(menu.contains(document.activeElement), "Opening the PR menu did not move keyboard focus inside");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(() => !document.querySelector(".pr-action-menu"));
    assert(document.activeElement === trigger, "Closing PR actions lost focus");
  } finally {
    root.unmount();
    document.documentElement.style.removeProperty("font-size");
    if (originalTheme) document.documentElement.setAttribute("data-theme", originalTheme);
    else document.documentElement.removeAttribute("data-theme");
  }
}
