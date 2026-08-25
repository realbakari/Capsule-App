import { describe, expect, it } from "vitest";
import { MockAgentRuntime } from "./mock.js";

function waitFor(
  runtime: MockAgentRuntime,
  runId: string,
  type: string,
): Promise<{ type: string; message: string; data?: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 4000);
    const stop = runtime.subscribeToRun(runId, (event) => {
      if (event.type === type || event.data?.status === type) {
        if (type === "lifecycle" && event.data?.status !== "completed" && event.data?.status !== "failed") {
          return;
        }
        clearTimeout(timeout);
        stop();
        resolve(event);
      }
    });
  });
}

describe("MockAgentRuntime", () => {
  it("streams a successful run to completion", async () => {
    const runtime = new MockAgentRuntime();
    await runtime.connect();
    const session = await runtime.createSession({ projectId: "proj_1" });
    const run = await runtime.sendMessage({
      sessionId: session.id,
      content: "Build a REST API for this project.",
      agentId: "coding",
    });
    const completed = await waitFor(runtime, run.id, "lifecycle");
    expect(run.status).toBe("running");
    expect(completed.message.length).toBeGreaterThan(0);
  });

  it("emits an approval request for [approval] prompts", async () => {
    const runtime = new MockAgentRuntime();
    await runtime.connect();
    const session = await runtime.createSession({ projectId: "proj_1" });
    const run = await runtime.sendMessage({
      sessionId: session.id,
      content: "Write a file [approval]",
    });
    const event = await waitFor(runtime, run.id, "approval.requested");
    expect(event.data?.approval).toBeTruthy();
  });
});
