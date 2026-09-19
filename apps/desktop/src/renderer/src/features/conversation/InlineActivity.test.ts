import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Run } from "@capsule/shared";
import { InlineActivity } from "./InlineActivity";
import type { ToolObservation } from "../../lib/turn-timeline";

const run = { id: "run", status: "completed" } as Run;
const tool = (kind: ToolObservation["kind"], title: string): ToolObservation => ({
  id: title, timestamp: "2026-09-15T00:00:00Z", title, command: kind === "execute", kind, status: "completed",
});

describe("inline activity icons", () => {
  it("shows a distinct icon per tool kind instead of one wrench", () => {
    const html = renderToStaticMarkup(createElement(InlineActivity, {
      tools: [tool("read", "Read README.md"), tool("execute", "git status")],
      run,
    }));
    expect(html).toContain('data-kind="read"');
    expect(html).toContain('data-kind="execute"');
    expect(html).toContain("1 command");
    expect(html).toContain("1 tool");
  });
});
