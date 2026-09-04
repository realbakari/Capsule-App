import { describe, expect, it } from "vitest";
import {
  acpCommandFailed,
  isAcpControlOutput,
  compactParams,
  explainAcpFailure,
  extractAcpSessionKey,
  extractGatewayText,
  isGatewayTurnDone,
  isAcpFailureText,
  isRuntimeFrame,
} from "./events.js";

describe("gateway chat extraction", () => {
  it("reads ChatEvent deltaText and final message content", () => {
    expect(extractGatewayText({ deltaText: "Hel" })).toBe("Hel");
    expect(extractGatewayText({ message: { content: "ACP ready" } })).toBe("ACP ready");
    expect(
      extractGatewayText({
        message: { content: [{ type: "text", text: "spawned " }, { text: "claude" }] },
      }),
    ).toBe("spawned claude");
  });

  it("treats final and aborted states as done", () => {
    expect(isGatewayTurnDone({ state: "delta" })).toBe(false);
    expect(isGatewayTurnDone({ state: "final" })).toBe(true);
    expect(isGatewayTurnDone({ state: "aborted" })).toBe(true);
  });

  it("flags ACP spawn failures", () => {
    expect(acpCommandFailed("ACP runtime backend is not configured")).toBeTruthy();
    expect(acpCommandFailed("This /acp action requires operator.admin on the internal channel.")).toBeTruthy();
    expect(acpCommandFailed('No API key found for provider "openai"')).toBeTruthy();
    expect(acpCommandFailed("⚠️ Conversation bindings are unavailable for webchat.")).toBeTruthy();
    expect(acpCommandFailed("Spawned ACP session agent:claude:acp:1")).toBeUndefined();
  });

  it("extracts the ACP session key from spawn confirmation", () => {
    expect(
      extractAcpSessionKey(
        "✅ Spawned ACP session agent:claude:acp:9b2c1a77-4e0a-4d3c-9f1e-2 (persistent, backend acpx).",
      ),
    ).toBe("agent:claude:acp:9b2c1a77-4e0a-4d3c-9f1e-2");
  });

  it("drops undefined RPC fields", () => {
    expect(compactParams({ key: "s1", message: undefined, cwd: "/repo" })).toEqual({
      key: "s1",
      cwd: "/repo",
    });
  });
});

describe("explainAcpFailure", () => {
  it("tells you what to do about a non-interactive permission prompt", () => {
    const out = explainAcpFailure(
      "ACP error (ACP_TURN_FAILED): Permission prompt unavailable in non-interactive mode",
    );
    expect(out).toContain("approve-all");
    expect(out).toContain("plugins.entries.acpx.config.permissionMode");
    expect(out).toContain("gateway restart");
    // The original line is kept so the underlying cause is not hidden.
    expect(out).toContain("ACP_TURN_FAILED");
  });

  it("explains an auth failure", () => {
    expect(explainAcpFailure("AcpRuntimeError: Authentication required")).toContain("not signed in");
  });

  it("explains the missing-provider case as a routing problem", () => {
    expect(explainAcpFailure('No API key found for provider "openai"')).toContain("Dedicate a harness");
  });

  it("passes unknown failures through unchanged", () => {
    expect(explainAcpFailure("something we have never seen")).toBe("something we have never seen");
  });

  it("returns undefined for empty input", () => {
    expect(explainAcpFailure("   ")).toBeUndefined();
    expect(explainAcpFailure(undefined)).toBeUndefined();
  });
});

describe("runtime frames must never become reply prose", () => {
  // Shapes taken verbatim from a session record that leaked into a reply.
  const runtimeFrame = (eventType: string | undefined, text: string) => ({
    agentId: "claude",
    data: { phase: "runtime_event", ...(eventType ? { eventType } : {}), text },
  });

  it("recognises a runtime frame by its phase, not only its eventType", () => {
    // The leak came from frames whose eventType was missing or unrecognised:
    // classifyRuntimeEvent returned undefined and undefined meant "prose".
    expect(isRuntimeFrame(runtimeFrame(undefined, "usage updated: 87690/200000"))).toBe(true);
    expect(isRuntimeFrame(runtimeFrame("something_new", "tool call (completed):"))).toBe(true);
    expect(isRuntimeFrame(runtimeFrame("status", "session updated"))).toBe(true);
  });

  it("leaves a plain gateway message alone", () => {
    expect(isRuntimeFrame({ text: "Here is the change you asked for." })).toBe(false);
    expect(isRuntimeFrame({ message: { content: "Done." } })).toBe(false);
    expect(isRuntimeFrame({})).toBe(false);
  });

  it("does not mistake a data payload that is not a runtime frame", () => {
    expect(isRuntimeFrame({ data: { text: "Here is the change." } })).toBe(false);
  });

  it("still extracts runtime text for the activity log", () => {
    // Excluded from the reply, but the execution log still needs to show it.
    expect(extractGatewayText(runtimeFrame("status", "usage updated: 87690/200000"))).toBe(
      "usage updated: 87690/200000",
    );
  });
});

describe("isAcpFailureText", () => {
  it("recognises the failure that was being stored as the agent's reply", () => {
    // Verbatim from a transcript where it appeared ten times as role=assistant.
    expect(
      isAcpFailureText(
        "AcpRuntimeError [ACP_TURN_FAILED]: Internal error: You've hit your session limit",
      ),
    ).toBe(true);
  });

  it("recognises the bare protocol codes", () => {
    expect(isAcpFailureText("ACP_TURN_FAILED: permission prompt unavailable")).toBe(true);
    expect(isAcpFailureText("[ACP_SESSION_CLOSED] session ended")).toBe(true);
  });

  it("leaves the agent's own prose alone", () => {
    expect(isAcpFailureText("I hit an error running the tests; here is why.")).toBe(false);
    expect(isAcpFailureText("The ACP adapter is configured correctly.")).toBe(false);
    expect(isAcpFailureText("")).toBe(false);
    expect(isAcpFailureText(undefined)).toBe(false);
  });
});

describe("isAcpControlOutput", () => {
  it("recognises the status dump that kept reaching the transcript", () => {
    // Verbatim shape of what a user saw twice: once as a stray tail, once as
    // the whole thing arriving as a run's output.
    const dump =
      "ACP status: ----- session: agent:claude:acp:f3627e45 backend: acpx agent: claude " +
      'acpx record id: agent:claude:acp:f3627e45 sessionMode: persistent state: idle ' +
      'runtimeDetails: {"cwd":"/Users/x/t3code","configOptions":[{"id":"model"}]}';
    expect(isAcpControlOutput(dump)).toBe(true);
  });

  it("recognises a doctor report and a runtime line", () => {
    expect(isAcpControlOutput("ACP doctor: everything looks fine")).toBe(true);
    expect(isAcpControlOutput("runtime: session=x backendSessionId=1c45effe pid=82746")).toBe(true);
    expect(isAcpControlOutput("✅ Cancel requested for ACP session agent:claude:acp:abc-123.")).toBe(true);
  });

  it("leaves the agent's own words alone", () => {
    // The guard must not eat an answer that happens to discuss ACP.
    expect(isAcpControlOutput("I checked the ACP adapter and it looks right.")).toBe(false);
    expect(isAcpControlOutput("Here is the status of your build: green.")).toBe(false);
    expect(isAcpControlOutput(undefined)).toBe(false);
    expect(isAcpControlOutput("   ")).toBe(false);
  });
});

describe("polling a pull request", () => {
  it("does not report 'no pull request' before an answer has landed", async () => {
    /*
     * The watcher stops itself when there is no open pull request. Reading an
     * empty cache as that answer would end the watch on its first tick, before
     * anything had been asked.
     */
    const { pollPullRequest } = await import("@capsule/filesystem");
    const first = pollPullRequest("/nonexistent/repo/for/this/test");
    expect(first.known).toBe(false);
    expect(first.value).toBeUndefined();
  });
});
