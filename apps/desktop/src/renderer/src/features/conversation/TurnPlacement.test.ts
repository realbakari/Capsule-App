import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Run } from "@capsule/shared";
import { Conversation } from "./Conversation";
import { ChangedFilesCard } from "./ChangedFilesCard";

const workspace = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../../lib/workspace", () => ({ useWorkspace: () => workspace.value }));
vi.mock("./Composer", () => ({ Composer: () => null }));
vi.mock("../terminal/TerminalDock", () => ({ PersistentTerminals: () => null }));
// Render the loading boundary as a marker to assert its transcript position
// without opening a browser or depending on a live filesystem.
vi.mock("./TurnOutcome", () => ({ TurnOutcome: ({ run }: { run: Run; }) => createElement("div", { "data-outcome": run.id }) }));

beforeEach(() => {
  workspace.value = {
    api: {}, projects: [], connected: true, ready: true, events: [], steps: [], agents: [], harnesses: [],
    session: { id: "s", projectId: "p" }, project: { id: "p", name: "Workspace", workingDirectory: "/repo" },
    messages: [
      { id: "u1", sessionId: "s", runId: "r1", role: "user", content: "Make a change", createdAt: "2026-09-04T00:00:01Z" },
      { id: "a1", sessionId: "s", runId: "r1", role: "assistant", content: "First reply", createdAt: "2026-09-04T00:00:02Z" },
      { id: "u2", sessionId: "s", runId: "r2", role: "user", content: "Follow up", createdAt: "2026-09-04T00:00:03Z" },
      { id: "a2", sessionId: "s", runId: "r2", role: "assistant", content: "Second reply", createdAt: "2026-09-04T00:00:04Z" },
    ],
    runs: [
      { id: "r2", sessionId: "s", projectId: "p", status: "completed", createdAt: "2026-09-04T00:00:03Z" },
      { id: "r1", sessionId: "s", projectId: "p", status: "completed", checkpointRef: "saved-first", createdAt: "2026-09-04T00:00:01Z" },
    ],
  };
});

describe("saved outcome placement", () => {
  it("places the latest verification below its work log without moving an older receipt", () => {
    workspace.value.events = [{ id: "e", runId: "r2", type: "tool", message: "read_file source.ts", timestamp: "2026-09-04T00:00:04Z" }];
    workspace.value.steps = [{ id: "work:read", label: "Read 1 file", count: 1, status: "complete" }];
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html.indexOf('data-verification-run="r2"')).toBeGreaterThan(html.indexOf('class="run-summary-label"'));
    expect(html.indexOf('data-verification-run="r1"')).toBeLessThan(html.indexOf("Follow up"));
    expect(html.match(/data-verification-run="r2"/g)).toHaveLength(1);
  });

  it("explains a missing reply without inventing an answer or a failed check", () => {
    workspace.value.messages = (workspace.value.messages as Array<{ id: string }>).filter((message) => message.id !== "a2");
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html.indexOf("No reply was received for this turn")).toBeGreaterThan(html.indexOf("Follow up"));
    expect(html).not.toContain("Check failed");
  });

  it("renders an older card between its reply and the next prompt, exactly once", () => {
    const html = renderToStaticMarkup(createElement(Conversation));
    const first = html.indexOf('data-outcome="r1"');
    expect(first).toBeGreaterThan(html.indexOf("First reply"));
    expect(first).toBeLessThan(html.indexOf("Follow up"));
    expect(html.match(/data-outcome="r1"/g)).toHaveLength(1);
    expect(html.indexOf('data-outcome="r2"')).toBeGreaterThan(html.indexOf("Second reply"));
  });

  it("does not carry cards or old messages across a project/session switch", () => {
    workspace.value.session = { id: "new-session", projectId: "new-project" };
    workspace.value.project = { id: "new-project", name: "Other", workingDirectory: "/other" };
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).not.toContain("data-outcome");
    expect(html).not.toContain("First reply");
    expect(html).toContain("conversation-empty");
  });

  it("does not make a repository's uncommitted files a chat outcome", () => {
    workspace.value.runs = [];
    workspace.value.git = { isRepo: true, files: [{ path: "unrelated.ts", code: "M", added: 10, removed: 5 }] };
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).not.toContain("files changed");
    expect(html).not.toContain("unrelated.ts");
  });

  it("keeps historical cards free of a current-file discard action", () => {
    const html = renderToStaticMarkup(createElement(ChangedFilesCard, { files: [{ path: "app.ts", action: "modified" }], onRestore() {} }));
    expect(html).toContain("Restore this turn");
    expect(html).not.toContain("Undo");
    expect(html).not.toContain("Discard changes");
    expect(html).not.toContain("disabled");
  });
});
