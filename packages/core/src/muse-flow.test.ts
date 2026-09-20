import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import * as harness from "@capsule/harness";
import { OpenClawAdapter } from "@capsule/openclaw";
import { PRESET_HARNESSES } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

it("runs Muse through the engine, persists its transcript, and resumes without a Gateway", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule muse flow-"));
  const fixture = fileURLToPath(new URL("../../muse/src/fixtures/agent.mjs", import.meta.url));
  const preset = PRESET_HARNESSES.find((item) => item.id === "muse")!;
  const originalCommand = preset.nativeCommand;
  preset.nativeCommand = { protocol: "msp", command: process.execPath, args: [fixture, "usage-initial"] };
  vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
  vi.stubEnv("MUSE_TEST_SCHEMA", "0".repeat(64)); // Additive fingerprint differences are advisory.
  vi.stubEnv("MUSE_TEST_STATE", path.join(directory, "native-state.json"));
  vi.spyOn(harness, "probeLoginStateNow").mockReturnValue("unknown");
  vi.spyOn(harness, "whichBinary").mockReturnValue(undefined);
  const gatewayConnect = vi.spyOn(OpenClawAdapter.prototype, "connect").mockRejectedValue(new Error("Gateway must not be contacted"));
  const options = { databasePath: path.join(directory, "state.sqlite"), userDataDir: directory };
  let engine = new CapsuleEngine(options);
  try {
    await engine.start();
    expect(engine.getSettings().runtimeMode).toBe("direct");
    expect((await engine.getStatus()).kind).toBe("openclaw");
    expect((await engine.getStatus()).state).toBe("disconnected");
    expect(await engine.listAgents()).not.toEqual(expect.arrayContaining([expect.objectContaining({ runtime: "mock" })]));
    const project = engine.createProject({ name: "Native agent fixture", workingDirectory: directory });
    const first = await engine.spawnHarness({ projectId: project.id, harnessId: "muse" });
    await vi.waitFor(() => expect(engine.providerUsage().reports).toHaveLength(1));
    expect(engine.providerUsage().reports[0]).toMatchObject({ sessionId: first.session.id, report: { providerId: "muse", window: { usedPercent: 0 } } });
    const second = await engine.spawnHarness({ projectId: project.id, harnessId: "muse" });
    await vi.waitFor(() => expect(engine.providerUsage().reports).toHaveLength(2));
    // The same provider-native ID belongs to different owned connections.
    expect(new Set(engine.providerUsage().reports.map((source) => source.sessionId)).size).toBe(2);
    await engine.closeHarness(second.session.id);
    expect(engine.providerUsage().reports.map((source) => source.sessionId)).toEqual([first.session.id]);
    expect(first.session.openclawSessionKey).toMatch(/^direct:msp:muse:/);
    expect(first.session.directSession).toMatchObject({ sessionId: "fixture-session", harnessId: "muse", cwd: directory });
    await engine.setHarnessConfig(first.session.id, "reasoning_effort", "max");
    expect(engine.listMessages(first.session.id)).toHaveLength(0);
    expect(engine.listRuns(first.session.id)).toHaveLength(0);
    const initial = await engine.sendMessage({ sessionId: first.session.id, agentId: "muse", content: "First prompt", mode: "chat" });
    await vi.waitFor(() => expect(engine.getRun(initial.run.id)?.status).toBe("completed"));
    await engine.stop();
    engine = new CapsuleEngine(options);
    await engine.start();
    await engine.updateSettings({ runtimeMode: "openclaw" }); // The existing native thread must stay local.
    const recovered = engine.listSessions().find((item) => item.id === first.session.id)!;
    expect(recovered.directSession).toEqual(first.session.directSession);
    const next = await engine.sendMessage({ sessionId: recovered.id, agentId: "muse", content: "Continue", mode: "chat" });
    await vi.waitFor(() => expect(engine.getRun(next.run.id)?.status).toBe("completed"));
    await vi.waitFor(async () => {
      const status = await engine.harnessStatus(recovered.id);
      expect(status.parsed?.reported?.configOptions.find((option) => option.id === "reasoning_effort")?.currentValue).toBe("max");
    });
    const answers = engine.listMessages(recovered.id).filter((message) => message.role === "assistant");
    expect(answers.map((message) => message.content)).toEqual(["Hello world", "Hello world"]);
    expect(engine.listSessions().find((item) => item.id === recovered.id)?.openclawSessionKey).toMatch(/^direct:msp:muse:/);
    expect(gatewayConnect).not.toHaveBeenCalled();
  } finally {
    await engine.stop();
    preset.nativeCommand = originalCommand;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
