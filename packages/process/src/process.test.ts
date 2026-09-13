import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnCommand } from "./index.js";

it("preserves argv through an executable or Windows command shim", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule command "));
  try {
    const script = path.join(dir, "args.cjs");
    writeFileSync(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
    const args = ["with spaces", 'a"quote', "(parens)", "x&echo bad", "pipe|value", "https://example.test/?a=1&b=2"];
    let command = process.execPath;
    let prefix = [script];
    if (process.platform === "win32") {
      command = path.join(dir, "agent.cmd"); prefix = [];
      writeFileSync(command, `@"${process.execPath}" "%~dp0args.cjs" %*\r\n`);
    }
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawnCommand(command, [...prefix, ...args], { windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
      let stdout = ""; let stderr = "";
      child.stdout?.on("data", (chunk) => { stdout += chunk; });
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`exit ${code}: ${stderr}`)));
    });
    expect(JSON.parse(output)).toEqual(args);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
