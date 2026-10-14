import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import * as harness from "@capsule/harness";
import { PRESET_HARNESSES } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

it.each(["normal", "approval", "settings"])("carries %s native turns through runs and approvals, then resumes after restart", async (scenario) => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-codex-flow-"));
  const fixture = fileURLToPath(new URL("../../codex/src/fixtures/agent.mjs", import.meta.url));
  const preset = PRESET_HARNESSES.find((item) => item.id === "codex")!;
  const original = preset.nativeCommand;
  preset.nativeCommand = { protocol: "codex", command: process.execPath, args: [fixture, scenario] };
  vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
  vi.spyOn(harness, "probeLoginStateNow").mockReturnValue("unknown");
  vi.spyOn(harness, "whichBinary").mockReturnValue(process.execPath);
  const options = { databasePath: path.join(directory, "state.sqlite"), userDataDir: directory };
  let engine = new CapsuleEngine(options);
  try {
    await engine.start();
    const project = engine.createProject({ name: "Native protocol fixture", workingDirectory: directory });
    const beforeDiscovery = engine.listSessions();
    const discovered = await engine.discoverHarness(project.id, "codex");
    expect(discovered.models?.availableModels.map((row) => row.modelId)).toEqual(["model-one", "model-two"]);
    expect(engine.listSessions()).toEqual(beforeDiscovery);
    expect(await engine.discoverHarness(project.id, "codex", "model-two")).toMatchObject({ models: { currentModelId: "model-two" } });
    const { session } = await engine.spawnHarness({ projectId: project.id, harnessId: "codex" });
    expect(session.openclawSessionKey).toMatch(/^direct:codex:codex:/);
    expect(session.directSession).toMatchObject({ sessionId: "native-thread", cwd: directory });
    if (scenario === "settings") {
      await engine.setHarnessConfig(session.id, "reasoning_effort", "high");
      await engine.setHarnessConfig(session.id, "permissions", "full-access");
      await engine.setHarnessOption({ sessionId: session.id, key: "model", value: "model-two" });
      expect(engine.listSessions().find((item) => item.id === session.id)?.directSession?.configuration).toEqual({
        model: "model-two", reasoning_effort: "low", permissions: "full-access",
      });
      expect(engine.listMessages(session.id)).toHaveLength(0);
      expect(engine.listRuns(session.id)).toHaveLength(0);
    }
    const first = await engine.sendMessage({ sessionId: session.id, content: "First", agentId: "codex", mode: "chat" });
    if (scenario === "approval") {
      await vi.waitFor(() => expect(engine.listApprovals("pending")).toHaveLength(1));
      await engine.resolveApproval(engine.listApprovals("pending")[0]!.id, "approved_once");
    }
    await vi.waitFor(() => expect(engine.getRun(first.run.id)?.status).toBe("completed"));
    await engine.stop();
    engine = new CapsuleEngine(options); await engine.start();
    const next = await engine.sendMessage({ sessionId: session.id, content: "Continue", agentId: "codex", mode: "chat" });
    if (scenario === "approval") {
      await vi.waitFor(() => expect(engine.listApprovals("pending")).toHaveLength(1));
      await engine.resolveApproval(engine.listApprovals("pending")[0]!.id, "approved_once");
    }
    await vi.waitFor(() => expect(engine.getRun(next.run.id)?.status).toBe("completed"));
    const answers = engine.listMessages(session.id).filter((message) => message.role === "assistant").map((message) => message.content);
    if (scenario === "settings") {
      expect(answers.map((answer) => JSON.parse(answer))).toEqual([0, 1].map(() => ({
        model: "model-two", effort: "low", approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" },
      })));
      await engine.setHarnessConfig(session.id, "permissions", "supervised");
      expect(engine.listSessions().find((item) => item.id === session.id)?.directSession?.configuration?.permissions).toBe("supervised");
    } else expect(answers).toEqual(["Hello model-one", "Hello model-one"]);
    const before = engine.listSessions().find((item) => item.id === session.id)!;
    engine.archiveSession(session.id); engine.restoreSession(session.id); engine.restoreSession(session.id);
    expect(engine.listSessions().find((item) => item.id === session.id)).toMatchObject({ state: "active", directSession: before.directSession, openclawSessionKey: before.openclawSessionKey });
    expect(engine.listMessages(session.id).filter((message) => message.role === "assistant")).toHaveLength(2);
  } finally {
    await engine.stop(); preset.nativeCommand = original;
    vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  }
});
