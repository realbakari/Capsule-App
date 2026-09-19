import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import * as harness from "@capsule/harness";
import { PRESET_HARNESSES, type CapsuleSettings } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

it("runs Muse through the engine, persists its transcript, and resumes without a Gateway", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule muse flow-"));
  const fixture = fileURLToPath(new URL("../../muse/src/fixtures/agent.mjs", import.meta.url));
  const preset = PRESET_HARNESSES.find((item) => item.id === "muse")!;
  const originalCommand = preset.nativeCommand;
  preset.nativeCommand = { protocol: "msp", command: process.execPath, args: [fixture] };
  vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
  vi.stubEnv("MUSE_TEST_SCHEMA", "0".repeat(64)); // Additive fingerprint differences are advisory.
  vi.spyOn(harness, "probeLoginStateNow").mockReturnValue("unknown");
  vi.spyOn(harness, "whichBinary").mockReturnValue(undefined);
  const options = { databasePath: path.join(directory, "state.sqlite"), userDataDir: directory, autoConnect: false };
  let engine = new CapsuleEngine(options);
  const selectNativeClient = () => {
    const internal = engine as unknown as { usingMock: boolean; settings: CapsuleSettings; bindAcpReplies(): void };
    internal.usingMock = false;
    internal.settings.runtimeMode = "openclaw"; // Native-only agents still use their own transport.
    internal.bindAcpReplies();
  };
  try {
    await engine.start();
    selectNativeClient();
    const project = engine.createProject({ name: "Native agent fixture", workingDirectory: directory });
    const first = await engine.spawnHarness({ projectId: project.id, harnessId: "muse" });
    expect(first.session.openclawSessionKey).toMatch(/^direct:msp:muse:/);
    expect(first.session.directSession).toMatchObject({ sessionId: "fixture-session", harnessId: "muse", cwd: directory });
    const initial = await engine.sendMessage({ sessionId: first.session.id, agentId: "muse", content: "First prompt", mode: "chat" });
    await vi.waitFor(() => expect(engine.getRun(initial.run.id)?.status).toBe("completed"));
    await engine.stop();
    engine = new CapsuleEngine(options);
    await engine.start();
    selectNativeClient();
    const recovered = engine.listSessions().find((item) => item.id === first.session.id)!;
    expect(recovered.directSession).toEqual(first.session.directSession);
    const next = await engine.sendMessage({ sessionId: recovered.id, agentId: "muse", content: "Continue", mode: "chat" });
    await vi.waitFor(() => expect(engine.getRun(next.run.id)?.status).toBe("completed"));
    const answers = engine.listMessages(recovered.id).filter((message) => message.role === "assistant");
    expect(answers.map((message) => message.content)).toEqual(["Hello world", "Hello world"]);
    expect(engine.listSessions().find((item) => item.id === recovered.id)?.openclawSessionKey).toMatch(/^direct:msp:muse:/);
  } finally {
    await engine.stop();
    preset.nativeCommand = originalCommand;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});
