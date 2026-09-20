import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { OpenClawAdapter } from "@capsule/openclaw";
import * as harness from "@capsule/harness";
import { CapsuleEngine } from "./engine.js";

it.each(["auto", "openclaw"] as const)("preserves explicit %s startup and manual Gateway connection", async (runtimeMode) => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-local-startup-"));
  const connect = vi.spyOn(OpenClawAdapter.prototype, "connect").mockRejectedValue(new Error("Offline fixture"));
  const options = { databasePath: path.join(directory, "state.sqlite"), userDataDir: directory };
  let engine = new CapsuleEngine(options);
  try {
    await engine.start();
    expect(connect).not.toHaveBeenCalled();
    vi.spyOn(harness, "whichBinary").mockReturnValue(undefined);
    const project = engine.createProject({ name: "Local prerequisites", workingDirectory: directory });
    await expect(engine.spawnHarness({ projectId: project.id, harnessId: "codex" })).rejects.toThrow("Install @agentclientprotocol/codex-acp");
    expect(connect).not.toHaveBeenCalled();
    await expect(engine.connectGateway()).rejects.toThrow("Offline fixture");
    expect(connect).toHaveBeenCalledTimes(1);
    await engine.updateSettings({ runtimeMode });
    await engine.stop();
    engine = new CapsuleEngine(options);
    await engine.start();
    expect(engine.getSettings().runtimeMode).toBe(runtimeMode);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(engine.getDiagnostics().gatewayStatus).toBe("disconnected");
    expect((await engine.getStatus()).state).toBe("disconnected");
  } finally {
    await engine.stop();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  }
});
