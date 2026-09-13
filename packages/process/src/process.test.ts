import { expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnCommand, spawnCommandSync } from "./index.js";

const launchers = process.platform === "win32"
  ? ["executable", "global.cmd", "local.cmd", "wrapper.bat", "path.cmd"]
  : ["executable"];

it.each(launchers)("preserves argv through %s in async and sync launches", async (launcher) => {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule command "));
  try {
    const script = path.join(dir, "args.cjs");
    writeFileSync(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
    const args = ["", "with spaces", 'a"quote', "(parens)", "x&echo bad", "pipe|value", "https://example.test/?a=1&b=2", "trailing slash\\", "café", "literal^caret"];
    let command = process.execPath;
    let prefix = [script];
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    if (launcher !== "executable") {
      const shimDir = launcher === "local.cmd" ? path.join(dir, "node_modules", ".bin") : dir;
      mkdirSync(shimDir, { recursive: true });
      command = path.join(shimDir, launcher === "wrapper.bat" ? "agent.bat" : "agent.cmd");
      prefix = [];
      writeFileSync(command, `@"${process.execPath}" "${script}" %*\r\n`);
      if (launcher === "path.cmd") {
        const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
        Object.assign(env, { [pathKey]: `${shimDir}${path.delimiter}${process.env[pathKey] ?? ""}` });
        command = "agent";
      }
    }
    const options = { windowsHide: true, env };
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawnCommand(command, [...prefix, ...args], options);
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => { stdout += chunk; });
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`exit ${code}: ${stderr}`)));
    });
    expect(JSON.parse(output)).toEqual(args);
    const result = spawnCommandSync(command, [...prefix, ...args], { ...options, encoding: "utf8" });
    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(args);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
