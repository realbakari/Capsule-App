import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CapsuleEngine } from "./engine.js";

async function waitForRun(engine: CapsuleEngine, runId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Run did not complete")), 5000);
    const onRun = () => {
      const run = engine.getRun(runId);
      if (run && ["completed", "failed", "cancelled", "approval_required"].includes(run.status)) {
        clearTimeout(timeout);
        engine.events.off("run", onRun);
        resolve();
      }
    };
    engine.events.on("run", onRun);
  });
}

describe("CapsuleEngine first user flow", () => {
  it("creates a project, conversation, run, verification, and artifact", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-engine-"));
    const engine = new CapsuleEngine({
      databasePath: path.join(dir, "capsule.sqlite"),
      userDataDir: dir,
    });
    await engine.start();
    const project = engine.createProject({ name: "API Workspace", defaultMode: "code" });
    const session = await engine.createSession({
      projectId: project.id,
      title: "Build REST API",
      mode: "code",
      agentId: "coding",
    });
    const { run } = await engine.sendMessage({
      sessionId: session.id,
      content: "Build a REST API for this project.",
      agentId: "coding",
      mode: "code",
    });
    await waitForRun(engine, run.id);
    const completed = engine.getRun(run.id);
    expect(completed?.status).toBe("completed");
    expect(engine.listMessages(session.id).some((message) => message.role === "assistant")).toBe(
      true,
    );
    expect(engine.listArtifacts(run.id).length).toBeGreaterThan(0);
    expect(engine.listRunEvents(run.id).some((event) => event.type === "contract")).toBe(true);
    await engine.stop();
  });
});
