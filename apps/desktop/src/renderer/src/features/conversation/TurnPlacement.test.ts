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
    api: {}, projects: [], sessions: [], connected: true, ready: true, events: [], steps: [], agents: [], harnesses: [],
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
  it("names each message for heading navigation, including steer and attachment-only prompts", () => {
    workspace.value.runs = [];
    workspace.value.messages = [
      { id: "u", sessionId: "s", role: "user", kind: "steer", content: "Follow this", createdAt: "2026-09-04T00:00:01Z" },
      { id: "a", sessionId: "s", role: "assistant", content: "# Result\n## Details", createdAt: "2026-09-04T00:00:02Z" },
      { id: "f", sessionId: "s", role: "user", content: "", attachments: [{ path: "/repo/a.txt", name: "a.txt", size: 1 }], createdAt: "2026-09-04T00:00:03Z" },
    ];
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).toContain('<h2 class="sr-only">You, steering</h2>');
    expect(html).toContain('<h2 class="sr-only">Agent</h2>');
    expect(html).toContain('<h2 class="sr-only">You</h2>');
    expect(html).toContain('<h3 class="md-h">Result</h3>');
    expect(html).toContain('<h4 class="md-h">Details</h4>');
  });
  it("adds no details row under a settled turn that answered", () => {
    workspace.value.events = [{ id: "e", runId: "r2", type: "tool", message: "read_file source.ts", timestamp: "2026-09-04T00:00:04Z" }];
    workspace.value.steps = [{ id: "work:read", label: "Read 1 file", count: 1, status: "complete" }];
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).not.toContain("data-run-summary");
    expect(html).not.toContain("Turn details");
    expect(html).not.toContain("run-event-log");
    expect(html).not.toContain("Completed · not verified");
  });

  it("keeps the details row for a turn that failed", () => {
    workspace.value.runs = [
      { id: "r2", sessionId: "s", projectId: "p", status: "failed", error: "Agent exited", createdAt: "2026-09-04T00:00:03Z" },
      { id: "r1", sessionId: "s", projectId: "p", status: "completed", createdAt: "2026-09-04T00:00:01Z" },
    ];
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html.match(/data-run-summary="r2"/g)).toHaveLength(1);
    expect(html).not.toContain('data-run-summary="r1"');
  });

  it("folds the agent's progress notes under one row and leaves the answer open", () => {
    workspace.value.messages = [
      { id: "u1", sessionId: "s", runId: "r1", role: "user", content: "Check the PR", createdAt: "2026-09-04T00:00:01Z" },
      { id: "n1", sessionId: "s", runId: "r1", role: "assistant", content: "Loading the diff.", createdAt: "2026-09-04T00:00:02Z" },
      { id: "n2", sessionId: "s", runId: "r1", role: "assistant", content: "Reading the tests.", createdAt: "2026-09-04T00:01:02Z" },
      { id: "a1", sessionId: "s", runId: "r1", role: "assistant", content: "No bugs found.", createdAt: "2026-09-04T00:02:31Z" },
    ];
    workspace.value.runs = [{ id: "r1", sessionId: "s", projectId: "p", status: "completed", createdAt: "2026-09-04T00:00:01Z", completedAt: "2026-09-04T00:02:31Z" }];
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).toContain("Worked for 2m 30s");
    expect(html).toContain("No bugs found.");
    expect(html).not.toContain("Loading the diff.");
    expect(html).not.toContain("Reading the tests.");
  });

  it("says you stopped a turn rather than that it worked", () => {
    workspace.value.messages = [
      { id: "u1", sessionId: "s", runId: "r1", role: "user", content: "Refactor", createdAt: "2026-09-04T00:00:01Z" },
      { id: "n1", sessionId: "s", runId: "r1", role: "assistant", content: "Starting.", createdAt: "2026-09-04T00:00:02Z" },
      { id: "a1", sessionId: "s", runId: "r1", role: "assistant", content: "Partial work.", createdAt: "2026-09-04T00:00:41Z" },
    ];
    workspace.value.runs = [{ id: "r1", sessionId: "s", projectId: "p", status: "cancelled", createdAt: "2026-09-04T00:00:01Z", completedAt: "2026-09-04T00:00:41Z" }];
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).toContain("You stopped after 40s");
  });

  it("shows a compact request as one divider, not a prompt and a reply", () => {
    workspace.value.messages = [
      ...(workspace.value.messages as unknown[]),
      { id: "u3", sessionId: "s", runId: "r3", role: "user", content: "/compact", createdAt: "2026-09-04T00:00:05Z" },
      { id: "a3", sessionId: "s", runId: "r3", role: "assistant", content: "Compacted the conversation.", createdAt: "2026-09-04T00:00:06Z" },
    ];
    workspace.value.runs = [
      { id: "r3", sessionId: "s", projectId: "p", status: "completed", createdAt: "2026-09-04T00:00:05Z" },
      ...(workspace.value.runs as unknown[]),
    ];
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).toContain("Context compacted");
    expect(html).not.toContain(">/compact<");
    expect(html).not.toContain("Compacted the conversation.");
  });

  it("explains a missing reply without inventing an answer or a failed check", () => {
    workspace.value.messages = (workspace.value.messages as Array<{ id: string }>).filter((message) => message.id !== "a2");
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html.indexOf("The agent finished without replying")).toBeGreaterThan(html.indexOf("Follow up"));
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
    expect(html).not.toContain("data-run-summary");
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
