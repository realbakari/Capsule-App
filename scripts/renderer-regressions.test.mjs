import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { resolveElectronBinary } from "./electron-path.mjs";

it("keeps renderer interactions recoverable and companion motion accessible", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "capsule-renderer-regressions-"));
  try {
    const bundle = await build({
      entryPoints: ["apps/desktop/src/renderer/src/testing/renderer-regressions.tsx"],
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"test"' },
      plugins: [{ name: "test-workspace", setup(builder) {
        builder.onResolve({ filter: /\/lib\/workspace$/ }, () => ({ path: "workspace", namespace: "test" }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `export { MODES, PERMISSION_OPTIONS } from ${JSON.stringify(path.resolve("apps/desktop/src/renderer/src/lib/workspace.tsx"))}; export const useWorkspace = () => window.testWorkspace;`, loader: "js", resolveDir: process.cwd() }));
      } }],
    });
    const script = path.join(directory, "test.js");
    await writeFile(script, bundle.outputFiles[0].text);
    const petStyles = await readFile("apps/desktop/src/renderer/src/features/pet/pet.css", "utf8");
    const composerStyles = (await readFile("packages/ui/src/tokens.css", "utf8")) + (await readFile("apps/desktop/src/renderer/src/styles.css", "utf8")).replace('@import "@capsule/ui/tokens.css";', "");
    await writeFile(path.join(directory, "index.html"), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style id="pet-test-styles">' + petStyles + '</style><style id="composer-test-styles" media="not all">' + composerStyles + '</style><div id="root"></div>');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(resolveElectronBinary(), [`--user-data-dir=${path.join(directory, "profile")}`, path.resolve("scripts/renderer-regressions.cjs"), `--renderer-test-bundle=${script}`], { env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      child.stderr.on("data", (data) => { output += data; });
      // A wedged renderer can prevent graceful Electron shutdown. This PID
      // belongs to this test and uses its disposable profile.
      const timer = setTimeout(() => { child.kill("SIGKILL"); }, 20_000);
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code, output: `${output}\nExit signal: ${signal ?? "none"}` }); });
    });
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("Companion regressions passed (reduce)");
    expect(result.output).toContain("Companion regressions passed (no-preference)");
    expect(result.output).toContain("Renderer regressions passed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
