import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { resolveElectronBinary } from "./electron-path.mjs";

it("executes browser tools against an isolated Electron page", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "capsule-browser-regressions-"));
  try {
    const entry = path.join(directory, "test.cjs");
    await build({ entryPoints: ["apps/desktop/src/main/testing/browser-regressions.ts"], outfile: entry, bundle: true, platform: "node", format: "cjs", external: ["electron"] });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(resolveElectronBinary(), [`--user-data-dir=${path.join(directory, "profile")}`, entry], { env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      const collect = (chunk) => { output = (output + chunk).slice(-20_000); };
      child.stdout.on("data", collect); child.stderr.on("data", collect);
      const timer = setTimeout(() => child.kill("SIGKILL"), 25_000);
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("exit", (code) => { clearTimeout(timer); resolve({ code, output }); });
    });
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("Browser regressions passed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
