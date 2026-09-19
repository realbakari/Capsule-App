import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComposerTasks } from "./ComposerTasks";

describe("composer tasks", () => {
  it("renders a collapsed count and an expanded live list", () => {
    const tasks = [
      { id: "0", content: "Map the Review panel", status: "completed" as const },
      { id: "1", content: "Add stack reads", status: "inProgress" as const },
      { id: "2", content: "Show the tree", status: "pending" as const },
    ];
    const html = renderToStaticMarkup(createElement(ComposerTasks, { tasks, running: true }));
    expect(html).toContain("1/3 complete");
    expect(html).toContain("Add stack reads");
    expect(html).toContain("Running");
    expect(html).toContain("Pending");
    expect(html).toContain('aria-expanded="true"');
    const ended = renderToStaticMarkup(createElement(ComposerTasks, { tasks, running: false }));
    expect(ended).toContain('aria-expanded="false"');
    expect(ended).not.toContain("Running");
    expect(ended).not.toContain("now");
    expect(renderToStaticMarkup(createElement(ComposerTasks, { tasks: [] }))).toBe("");
  });
});
