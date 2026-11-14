import { describe, expect, it } from "vitest";

import { threadExportMarkdown } from "./thread-markdown.js";
import type { ChatMessage, Run, RunEvent, Session } from "./types.js";

const session: Session = {
  id: "s1", workspaceId: "w", projectId: "p", agentId: "coding", harnessId: "claude",
  title: "Fix the login form", mode: "code", state: "active", modelOverride: "sonnet",
  createdAt: "2026-03-04T09:15:30.000Z", updatedAt: "2026-03-04T10:00:00.000Z",
};

function message(id: string, role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, sessionId: "s1", role, content, createdAt: `2026-03-04T09:${id.padStart(2, "0")}:00.000Z`, ...extra };
}

function run(id: string, extra: Partial<Run> = {}): Run {
  return { id, sessionId: "s1", projectId: "p", agentId: "coding", status: "completed", prompt: "", createdAt: "2026-03-04T09:00:00.000Z", updatedAt: "2026-03-04T09:00:00.000Z", ...extra };
}

function event(id: string, runId: string, type: string, data: Record<string, unknown>, message = ""): RunEvent {
  return { id, runId, type, message, data, timestamp: `2026-03-04T09:20:${id.padStart(2, "0")}.000Z` };
}

describe("threadExportMarkdown", () => {
  it("writes a title, a header, quoted prompts and verbatim replies", () => {
    const markdown = threadExportMarkdown(session, [
      message("2", "assistant", "Done. The form now **validates** on blur.", { runId: "r1" }),
      message("1", "user", "Validate the email field.\n\nKeep the copy short.", { runId: "r1" }),
      message("3", "system", "Agent switched model"),
    ], [run("r1")], { agentName: "Claude Code", projectName: "Web app" });
    expect(markdown).toMatchInlineSnapshot(`
      "# Fix the login form

      - **Agent:** Claude Code
      - **Model:** sonnet
      - **Project:** Web app
      - **Started:** 2026-03-04 09:15 UTC
      - **Turns:** 1

      ## Turn 1

      > Validate the email field.
      >
      > Keep the copy short.

      Done. The form now **validates** on blur.
      "
    `);
  });

  it("keeps code fences inside a reply intact", () => {
    const reply = "Run this:\n\n```sh\npnpm test -- --run\n```\n\nThen:\n\n````md\n```js\nnested\n```\n````";
    const markdown = threadExportMarkdown(session, [
      message("1", "user", "How do I run tests?", { runId: "r1" }),
      message("2", "assistant", reply, { runId: "r1" }),
    ], [run("r1")]);
    expect(markdown).toContain(reply);
    expect(markdown.endsWith(`${reply}\n`)).toBe(true);
  });

  it("names attachments without their local paths", () => {
    const markdown = threadExportMarkdown(session, [
      message("1", "user", "What is wrong here?", {
        runId: "r1",
        attachments: [
          { name: "screenshot.png", path: "/Users/someone/Desktop/screenshot.png", size: 10, mimeType: "image/png" },
          { name: "odd`name.txt", path: "/tmp/odd`name.txt", size: 3 },
        ],
      }),
      message("2", "assistant", "The button overlaps the field.", { runId: "r1" }),
    ], [run("r1")]);
    expect(markdown).toContain("_Attached: `screenshot.png`, ``odd`name.txt``_");
    expect(markdown).not.toContain("/Users/someone");
  });

  it("lists tool activity folded and changed files only when asked", () => {
    const messages = [
      message("1", "user", "Add a test", { runId: "r1" }),
      message("2", "assistant", "Added one test.", { runId: "r1" }),
    ];
    const events = [
      event("1", "r1", "tool", { toolCallId: "a", title: "Read src/login.ts", kind: "read", status: "in_progress" }),
      event("2", "r1", "tool", { toolCallId: "a", status: "completed" }),
      event("3", "r1", "tool", { toolCallId: "b", title: "pnpm test", kind: "execute", status: "failed" }),
      event("4", "r1", "status", {}, "Thinking"),
      event("5", "other", "tool", { toolCallId: "c", title: "Not this turn" }),
    ];
    const changedFiles = { r1: [{ path: "src/login.test.ts", added: 12, status: "added" as const }, { path: "src/login.ts", added: 2, removed: 1 }] };
    expect(threadExportMarkdown(session, messages, [run("r1")], { events, changedFiles })).not.toContain("<details>");
    const markdown = threadExportMarkdown(session, messages, [run("r1")], { events, changedFiles, includeToolActivity: true, includeChangedFiles: true });
    expect(markdown.slice(markdown.indexOf("Added one test."))).toMatchInlineSnapshot(`
      "Added one test.

      <details>
      <summary>2 tool calls (1 failed)</summary>

      - \`Read src/login.ts\`
      - \`pnpm test\` — failed

      </details>

      **Changed files**

      - \`src/login.test.ts\` (added, +12)
      - \`src/login.ts\` (+2 −1)
      "
    `);
  });

  it("uses a run's result when no reply message carries it, and notes failures and steers", () => {
    const markdown = threadExportMarkdown(session, [
      message("1", "user", "Summarise the README", { runId: "r1" }),
      message("2", "user", "Shorter, please", { runId: "r1", kind: "steer" }),
      message("3", "user", "Now deploy", { runId: "r2" }),
    ], [run("r1", { result: "It describes a CLI." }), run("r2", { status: "failed", error: "No credentials\nfor deploy" })]);
    expect(markdown).toContain("> **Steer:** Shorter, please\n\nIt describes a CLI.");
    expect(markdown).toContain("## Turn 2\n\n> Now deploy\n\n_Turn failed: No credentials for deploy_");
    expect(markdown).toContain("- **Turns:** 2");
  });

  it("keeps each turn's final reply, not the narration before it, and an attachment-only prompt", () => {
    const markdown = threadExportMarkdown(session, [
      message("1", "user", "", { runId: "r1", attachments: [{ name: "trace.log", path: "/tmp/trace.log", size: 1 }] }),
      message("2", "assistant", "Let me look at the log.", { runId: "r1" }),
      message("3", "assistant", "The timeout is in the retry loop.", { runId: "r1" }),
    ], [run("r1")]);
    expect(markdown).not.toContain("Let me look at the log.");
    expect(markdown).toContain("_Attached: `trace.log`_\n\nThe timeout is in the retry loop.");
  });

  it("is the same bytes every time", () => {
    const input = [message("1", "user", "Hi", { runId: "r1" }), message("2", "assistant", "Hello", { runId: "r1" })];
    expect(threadExportMarkdown(session, input, [run("r1")])).toBe(threadExportMarkdown(session, [...input].reverse(), [run("r1")]));
    expect(threadExportMarkdown({ ...session, title: "" }, [], [])).toContain("# Untitled conversation");
    expect(threadExportMarkdown(session, [], [])).toContain("_No messages yet._");
  });
});
