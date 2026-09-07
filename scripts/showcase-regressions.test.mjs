import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { resolveElectronBinary } from "./electron-path.mjs";

it("loads the public showcase without leaking desktop controls or overflowing mobile", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "capsule-showcase-"));
  try {
    await build({
      entryPoints: ["apps/desktop/src/renderer/src/main.tsx"], outdir: directory,
      bundle: true, platform: "browser", format: "esm", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"test"' },
      loader: { ".woff2": "file", ".woff": "file", ".ttf": "file", ".png": "file" },
    });
    await writeFile(path.join(directory, "index.html"), `<!doctype html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'">
      <link rel="stylesheet" href="/main.css"></head><body><div id="root"></div>
      <script type="module" src="/main.js"></script></body></html>`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(resolveElectronBinary(), [
        `--user-data-dir=${path.join(directory, "profile")}`,
        path.resolve("scripts/showcase-regressions.cjs"), `--showcase-root=${directory}`,
      ], { env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      child.stderr.on("data", (data) => { output += data; });
      const timer = setTimeout(() => child.kill("SIGKILL"), 25_000);
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("exit", (code) => { clearTimeout(timer); resolve({ code, output }); });
    });
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("Showcase regressions passed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
