import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@capsule/shared";
import { FileDiff } from "./FileDiff";
import { PullRequestList } from "./PullRequestList";
import { PullRequestChecks } from "./PullRequestChecks";
import { PullRequestComment } from "./PullRequestActivity";

describe("pull request read controls", () => {
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
