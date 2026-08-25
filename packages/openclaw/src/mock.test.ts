import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
    expect(String(completed.data?.output ?? completed.message)).toContain("Mock runtime");
    expect(String(completed.data?.output ?? "")).not.toContain("src/index.ts");
  });

  it("lists real files from the project folder instead of inventing them", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-mock-ws-"));
    mkdirSync(path.join(dir, "lib"));
    writeFileSync(path.join(dir, "README.md"), "# hello\n");
    writeFileSync(path.join(dir, "lib", "main.ts"), "export {}\n");
    const runtime = new MockAgentRuntime();
    runtime.setWorkspace(dir);
    await runtime.connect();
    const session = await runtime.createSession({ projectId: "proj_1" });
    const run = await runtime.sendMessage({
      sessionId: session.id,
      content: "Review this repo.",
    });
    const completed = await waitFor(runtime, run.id, "lifecycle");
    const output = String(completed.data?.output ?? "");
    expect(output).toContain(dir);
    expect(output).toContain("README.md");
    expect(output).not.toContain("src/index.ts");
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
