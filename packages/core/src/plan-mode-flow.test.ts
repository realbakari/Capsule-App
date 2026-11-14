import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ACT_ON_PLAN_PROMPT, tasksFromRunEvents } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

async function waitForRun(engine: CapsuleEngine, runId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Run did not complete")), 10_000);
    const check = () => {
      const run = engine.getRun(runId);
      if (run && ["completed", "failed", "cancelled"].includes(run.status)) {
        clearTimeout(timeout); engine.events.off("run", check); resolve();
      }
    };
    engine.events.on("run", check); check();
  });
}

async function open(dir: string) {
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  return engine;
}

it("plans without editing on the demo runtime, then acts on the plan, and keeps both modes on disk", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-plan-"));
  const engine = await open(dir);
  await engine.updateSettings({ startInPlanMode: true });
  const project = engine.createProject({ name: "Plan Workspace" });
  const session = await engine.createSession({ projectId: project.id, title: "Plan it" });
  expect(session.turnMode).toBe("plan");

  const planned = await engine.sendMessage({ sessionId: session.id, content: "Add a settings page." });
  await waitForRun(engine, planned.run.id);
  expect(engine.getRun(planned.run.id)?.turnMode).toBe("plan");
  const reply = engine.listMessages(session.id).filter((message) => message.role === "assistant").at(-1)?.content ?? "";
  expect(reply).toMatch(/Nothing was edited/);
  expect(reply).toMatch(/^1\. /m);
  const events = engine.listRunEvents(planned.run.id);
  expect(events.find((event) => event.type === "plan-mode")?.data).toMatchObject({ turnMode: "plan", carrier: "mock" });
  expect(tasksFromRunEvents(events).length).toBeGreaterThan(1);

  const switched = await engine.setSessionTurnMode(session.id, "act");
  expect(switched.session.turnMode).toBe("act");
  const acted = await engine.sendMessage({ sessionId: session.id, content: ACT_ON_PLAN_PROMPT });
  await waitForRun(engine, acted.run.id);
  expect(engine.getRun(acted.run.id)?.turnMode).toBe("act");
  expect(engine.listRunEvents(acted.run.id).some((event) => event.type === "plan-mode")).toBe(false);
  await engine.stop();

  const reopened = await open(dir);
  expect(reopened.listSessions(project.id).find((row) => row.id === session.id)?.turnMode).toBe("act");
  expect(reopened.getRun(planned.run.id)?.turnMode).toBe("plan");
  expect(reopened.listRuns(session.id).map((run) => run.turnMode).sort()).toEqual(["act", "plan"]);
  await reopened.stop();
});

it("moves the saved Plan and Act models with the mode, before and after the agent starts", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-plan-models-"));
  const engine = await open(dir);
  await engine.updateSettings({ modeModels: { claude: { plan: "deep-model", act: "fast-model" } } });
  const project = engine.createProject({ name: "Models Workspace" });
  await engine.dedicateHarness(project.id, "claude");
  const session = await engine.createSession({ projectId: project.id, title: "Models", turnMode: "plan" });
  expect(session.modelOverride).toBe("deep-model");
  // The composer spawns a draft's agent before its first message, naming no model.
  const spawned = await engine.spawnHarness({ projectId: project.id, sessionId: session.id, harnessId: "claude" });
  expect(spawned.session.modelOverride).toBe("deep-model");

  const first = await engine.sendMessage({ sessionId: session.id, content: "Plan the work." });
  await waitForRun(engine, first.run.id);
  expect(engine.listSessions(project.id).find((row) => row.id === session.id)?.harnessState).toMatch(/^(running|waiting)$/);

  const act = await engine.setSessionTurnMode(session.id, "act");
  expect(act.detail).toBeUndefined();
  expect(act.session.modelOverride).toBe("fast-model");
  const plan = await engine.setSessionTurnMode(session.id, "plan");
  expect(plan.session.modelOverride).toBe("deep-model");
  await expect(engine.setSessionTurnMode(session.id, "think" as never)).rejects.toThrow("Plan or Act");
  await engine.stop();
});
