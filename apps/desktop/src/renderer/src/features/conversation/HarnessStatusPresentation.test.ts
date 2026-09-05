import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessLiveStatus } from "@capsule/shared";
import { Conversation } from "./Conversation";
import { HarnessSessionDiagnostics } from "../harness/HarnessSessionDiagnostics";

const workspace = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../../lib/workspace", () => ({ useWorkspace: () => workspace.value }));
vi.mock("./Composer", () => ({ Composer: () => null }));
vi.mock("../terminal/TerminalDock", () => ({ PersistentTerminals: () => null }));

const report = 'ACP status: ----- session: agent:claude:acp:abc-123 backend: acpx state: idle runtimeOptions: model=opus runtimeDetails: {"configOptions":[{"id":"model","currentValue":"opus"}]}';
const live: HarnessLiveStatus = {
  session: { id: "session-1", projectId: "project-1", agentId: "claude", title: "Model selection", mode: "code", state: "active" },
  harnessId: "claude",
  state: "waiting",
  statusText: report,
  parsed: { model: "opus", models: { currentModelId: "opus", availableModels: [{ modelId: "opus", name: "Opus" }] } },
};

beforeEach(() => {
  workspace.value = {
    api: {}, messages: [], runs: [], events: [], steps: [], agents: [], harnesses: [],
    connected: true, ready: true,
    session: { id: "session-1", modelOverride: "opus" },
    harnessStatuses: { "session-1": live },
    // Reproduce the previous global state left by changing a model or pressing
    // Refresh. Even an old context retained by hot reload must not render it.
    statusText: report,
  };
});

describe("harness status presentation", () => {
  it("does not turn model status into a chat banner or a new conversation", () => {
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).not.toContain("ACP status:");
    expect(html).not.toContain("runtimeDetails");
    expect(html).not.toContain('class="notice status"');
    expect(html).toContain("conversation-empty");
    expect(html).toContain("What should we work on?");
  });

  it("keeps real action errors visible while leaving diagnostics out", () => {
    workspace.value.notice = "This model is unavailable. Choose another model.";
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).toContain("This model is unavailable.");
    expect(html).not.toContain("runtimeDetails");
  });

  it("hides historical status replies without hiding the empty-thread state", () => {
    workspace.value.messages = [{ id: "old-status", sessionId: "session-1", role: "assistant", content: report, createdAt: "2026-09-04T00:00:00Z" }];
    const html = renderToStaticMarkup(createElement(Conversation));
    expect(html).not.toContain("runtimeDetails");
    expect(html).toContain("conversation-empty");
  });

  it("keeps raw status available only inside a collapsed, safely escaped disclosure", () => {
    const html = renderToStaticMarkup(createElement(HarnessSessionDiagnostics, {
      status: { ...live, statusText: `${report}\n<script>example</script>` },
    }));
    expect(html).toContain('<details class="harness-session-diagnostics">');
    expect(html).toContain("Session diagnostics");
    expect(html).toContain("ACP status:");
    expect(html).not.toContain(" open=");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;example&lt;/script&gt;");
    expect(renderToStaticMarkup(createElement(HarnessSessionDiagnostics, {}))).toBe("");
    // A different session remounts the native disclosure instead of inheriting
    // the open state of whichever session was inspected before it.
    expect(HarnessSessionDiagnostics({ status: live })?.key).toBe("session-1");
    expect(HarnessSessionDiagnostics({ status: { ...live, session: { ...live.session, id: "session-2" } } })?.key).toBe("session-2");
  });
});
