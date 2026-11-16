import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isHarnessId, PRESET_HARNESSES } from "@capsule/shared";
import { whichBinary } from "../index.js";
import { launchCommand } from "./plan.js";
import { createAgentStore } from "./service.js";

/*
 * Installs one real agent from the live registry. Off by default: it
 * downloads tens of megabytes.
 *   CAPSULE_STORE_SMOKE=kimi CAPSULE_STORE_SMOKE_DIR=<empty temp dir> node scripts/test.mjs packages/harness/src/store/smoke.test.ts
 */
const harnessId = process.env.CAPSULE_STORE_SMOKE;
const agentsDir = process.env.CAPSULE_STORE_SMOKE_DIR;

describe.runIf(harnessId && agentsDir)("agent store smoke", () => {
  it("installs a real agent and runs it through its shim", async () => {
    if (!isHarnessId(harnessId) || !agentsDir) throw new Error("set CAPSULE_STORE_SMOKE to a harness id");
    const npmPath = whichBinary(["npm"]);
    const nodePath = whichBinary(["node"]);
    const phases: string[] = [];
    const store = createAgentStore({
      agentsDir,
      emit: (progress) => {
        if (phases.at(-1) !== progress.phase) phases.push(progress.phase);
      },
      host: () => ({
        platform: process.platform,
        arch: process.arch,
        hasNode: Boolean(npmPath),
        ...(npmPath ? { npmPath } : {}),
        ...(nodePath ? { nodeDir: path.dirname(nodePath) } : {}),
      }),
      userPath: () => undefined,
      changed: () => undefined,
    });
    const entry = await store.install(harnessId);
    console.log(JSON.stringify({ entry, phases }));
    expect(entry.installed?.version).toBe(entry.offer?.version);
    const listed = (await store.list()).find((item) => item.harnessId === harnessId);
    expect(listed?.updateAvailable).toBe(false);
    const command = path.join(agentsDir, "bin", launchCommand(PRESET_HARNESSES.find((preset) => preset.id === harnessId)!)!);
    const shim = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 60_000 });
    console.log(JSON.stringify({ status: shim.status, stdout: shim.stdout.slice(0, 300), stderr: shim.stderr.slice(0, 300) }));
    expect(shim.status).toBe(0);
  }, 600_000);
});
