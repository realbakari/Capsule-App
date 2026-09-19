import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@capsule/shared";
import { FileDiff } from "./FileDiff";
import { PagedFileDiffs, diffBlockKeys } from "./PagedFileDiffs";
import { DiffView } from "./DiffView";
import { DIFF_PAGE_ROWS, DIFF_PAGE_FILES } from "./DiffPager";
import { PullRequestList } from "./PullRequestList";
import { GitPullRequestDetail } from "./PullRequestDetail";
import { PullRequestChecks } from "./PullRequestChecks";
import { PullRequestComment } from "./PullRequestActivity";

describe("pull request read controls", () => {
  it("assigns independent identities to same-path type changes and repeated blocks", () => {
    const files = parseUnifiedDiff("diff --git a/link.txt b/link.txt\ndeleted file mode 100644\n--- a/link.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n"
      + "diff --git a/link.txt b/link.txt\nnew file mode 120000\n--- /dev/null\n+++ b/link.txt\n@@ -0,0 +1 @@\n+target\n");
    expect(files).toHaveLength(2);
    expect(new Set(diffBlockKeys([...files, ...files])).size).toBe(4);
  });
  it.each([true, false])("bounds a 20,000-line expanded diff in split=%s", (split) => {
    const file = parseUnifiedDiff(`diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1,20000 @@\n${Array.from({ length: 20_000 }, (_, i) => `+const item${i} = ${i};`).join("\n")}\n`)[0]!;
    const html = renderToStaticMarkup(createElement(FileDiff, { file, split, expanded: true }));
    expect(html.match(/class="diff-gutter-num"/g)).toHaveLength(DIFF_PAGE_ROWS * 2);
    expect(html).toContain("Diff rows");
    expect(html).not.toContain("item19999");
    expect(html.length).toBeLessThan(150_000);
    const many = renderToStaticMarkup(createElement(PagedFileDiffs, { files: Array.from({ length: 100 }, (_, i) => ({ ...file, path: `${i}.ts` })), split }));
    expect(many.match(/class="file-diff /g)).toHaveLength(DIFF_PAGE_FILES);
    expect(many).not.toContain('class="file-diff-body');
    const plain = renderToStaticMarkup(createElement(DiffView, { text: Array.from({ length: 20_000 }, (_, i) => `+line ${i}`).join("\n") }));
    expect(plain.match(/class="diff-line /g)).toHaveLength(DIFF_PAGE_ROWS);
  });
  it("honors controlled collapse and expand states for the same diff", () => {
    const file = parseUnifiedDiff("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n")[0]!;
    const render = (expanded: boolean) => renderToStaticMarkup(createElement(FileDiff, { file, split: false, expanded }));
    expect(render(false)).toContain('aria-expanded="false"');
    expect(render(false)).not.toContain('class="file-diff-body');
    expect(render(true)).toContain('aria-expanded="true"');
    expect(render(true)).toContain('class="file-diff-body');
  });

  it("shows retry, not a false empty state, after a failed list read", () => {
    const html = renderToStaticMarkup(createElement(PullRequestList, { loading: false, error: "Incomplete response", onRefresh() {}, onSelect() {} }));
    expect(html).toContain("Retry");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("No open pull requests");
    expect(html).not.toContain("(0)");
  });

  it("shows a stack layer badge without changing a failed list into an empty one", () => {
    const html = renderToStaticMarkup(createElement(PullRequestList, {
      items: [{
        number: 3,
        title: "Service restart",
        url: "https://github.com/example/repo/pull/3",
        state: "OPEN",
        isDraft: false,
        stack: { number: 9, size: 16, position: 3, base: "main" },
      }],
      loading: false,
      onRefresh() {},
      onSelect() {},
    }));
    expect(html).toContain("3/16");
    expect(html).toContain("Stack layer 3 of 16");
  });

  it("renders the stack from the base up and offers merge from an open layer", () => {
    const html = renderToStaticMarkup(createElement(GitPullRequestDetail, {
      summary: {
        number: 1,
        title: "Base",
        url: "https://github.com/example/repo/pull/1",
        state: "OPEN",
        isDraft: false,
        stack: { number: 9, size: 2, position: 1, base: "main" },
      },
      detail: {
        number: 1,
        title: "Base",
        url: "https://github.com/example/repo/pull/1",
        state: "OPEN",
        isDraft: false,
        body: "",
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        labels: [],
        reviewers: [],
        activity: [],
        commits: [],
        files: [],
        checkRuns: [],
        diff: "",
        stack: { number: 9, size: 2, position: 1, base: "main" },
        stackDetail: {
          number: 9,
          base: "main",
          layers: [
            { number: 1, title: "Base", headBranch: "feat/one", headSha: "a".repeat(40), state: "open" },
            { number: 2, title: "Middle", headBranch: "feat/two", headSha: "b".repeat(40), state: "open" },
          ],
        },
      },
      loading: false,
      onRefresh() {},
      onLoadCommitDiff: async () => "",
      onBack() {},
      onOpenBrowser() {},
      onOpenUrl() {},
      onMergeStack() {},
      onRebaseStack() {},
    }));
    expect(html).toContain("Merge stack");
    expect(html).not.toContain("Rebase stack");
    const layers = html.slice(html.indexOf("pr-stack-layers"));
    expect(layers.indexOf("#2")).toBeLessThan(layers.indexOf("#1"));
    expect(html).toContain("The stack base is at the bottom");
  });

  it("does not offer merge stack when a closed layer sits below the selection", () => {
    const html = renderToStaticMarkup(createElement(GitPullRequestDetail, {
      summary: {
        number: 2,
        title: "Top",
        url: "https://github.com/example/repo/pull/2",
        state: "OPEN",
        isDraft: false,
        stack: { number: 9, size: 2, position: 2, base: "main" },
      },
      detail: {
        number: 2,
        title: "Top",
        url: "https://github.com/example/repo/pull/2",
        state: "OPEN",
        isDraft: false,
        body: "",
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        labels: [],
        reviewers: [],
        activity: [],
        commits: [],
        files: [],
        checkRuns: [],
        diff: "",
        stack: { number: 9, size: 2, position: 2, base: "main" },
        stackDetail: {
          number: 9,
          base: "main",
          layers: [
            { number: 1, title: "Base", headBranch: "feat/one", headSha: "a".repeat(40), state: "closed" },
            { number: 2, title: "Top", headBranch: "feat/two", headSha: "b".repeat(40), state: "open" },
          ],
        },
      },
      loading: false,
      onRefresh() {},
      onLoadCommitDiff: async () => "",
      onBack() {},
      onOpenBrowser() {},
      onOpenUrl() {},
      onMergeStack() {},
      onRebaseStack() {},
    }));
    expect(html).not.toContain("Merge stack");
  });

  it("renders check rows without requiring a second nested disclosure", () => {
    const html = renderToStaticMarkup(createElement(PullRequestChecks, { checks: [{ name: "Build", state: "failure", url: "https://github.com/example/repo/actions/runs/1" }], onOpenUrl() {} }));
    expect(html).toContain("Build");
    expect(html).not.toContain('aria-expanded="false"');
    expect(html).not.toContain('target="_blank"');
    expect(html).toContain("Failed");
    expect(html).toContain('class="pr-check-copy"');
  });

  it.each([true, false])("highlights and preserves code in split=%s with reversible wrapping", (split) => {
    const file = parseUnifiedDiff('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const old = 1;\n+const next = "<script>example</script>";\n')[0]!;
    const render = (wrap: boolean) => renderToStaticMarkup(createElement(FileDiff, { file, split, wrap }));
    expect(render(true)).toContain('class="tok-kw">const</span>');
    expect(render(true)).toContain('class="tok-str"');
    expect(render(true)).toContain("&lt;script&gt;");
    expect(render(true)).not.toContain("<script>");
    expect(render(true)).toContain("is-wrapped");
    expect(render(false)).toContain("is-scrollable");
    expect(render(false)).toContain('tabindex="0"');
  });

  it("offers collapsible, safely rendered comments without inventing a resolved state", () => {
    const activity = { id: "r1", kind: "review" as const, author: "reviewer", state: "CHANGES_REQUESTED", body: '<!-- metadata -->#### Findings\n\n**Important**\n\n<a href="https://example.com">Read review</a>' };
    const props = { activity, baseUrl: "https://github.com/example/repo/pull/1", onOpenUrl() {} };
    const html = renderToStaticMarkup(createElement(PullRequestComment, props));
    expect(html).toContain('<details class="pr-comment-card" open="">');
    expect(html).toContain("Changes requested");
    expect(html).toContain('class="md-h">Findings');
    expect(html).not.toMatch(/metadata|&lt;a|Resolved/);
    expect(renderToStaticMarkup(createElement(PullRequestComment, { ...props, defaultOpen: false }))).not.toContain('open=""');
  });
});
