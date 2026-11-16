import { describe, expect, it } from "vitest";
import { commandShell, interactiveShellArgs } from "./shell.js";
import { runInDirectory, startPty } from "./index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("platform shells", () => {
  it("selects Windows PowerShell without a Unix login flag", () => {
    const shell = commandShell('Write-Output "quoted & literal"', "win32");
    expect(shell.file).toMatch(/powershell\.exe$/u);
    expect(shell.args).toContain("-NonInteractive");
    expect(shell.args.at(-1)).toContain('Write-Output "quoted & literal"');
    expect(interactiveShellArgs(shell.file, "win32")).toEqual(["-NoLogo"]);
    expect(interactiveShellArgs("cmd.exe", "win32")).toEqual([]);
    expect(commandShell("pwd", "darwin")).toEqual({ file: "/bin/zsh", args: ["-lc", "pwd"] });
  });
  it("preserves command failures and cancellation", async () => {
    expect((await runInDirectory(tmpdir(), "exit 7")).code).toBe(7);
    const controller = new AbortController(); controller.abort();
    await expect(runInDirectory(tmpdir(), "echo never", 5000, controller.signal)).rejects.toThrow("cancelled");
  });
  it("runs an interactive native shell in a path containing spaces", { timeout: 10_000 }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule pty "));
    let session: ReturnType<typeof startPty> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(() => { session?.kill(); reject(new Error(`PTY did not finish: ${output}`)); }, 7000);
        session = startPty({ cwd: dir }, {
          onData: (text) => { output += text; },
          onExit: (code) => { clearTimeout(timer); if (code === 0 && output.includes("capsule-pty-ready")) resolve(); else reject(new Error(`PTY exited ${code}: ${output}`)); },
        });
        session.write("echo capsule-pty-ready\rexit\r");
      });
    } finally { session?.kill(); rmSync(dir, { recursive: true, force: true }); }
  });
  it.skipIf(process.platform === "win32")("runs argv directly, with no shell between, and adds the given env", { timeout: 10_000 }, async () => {
    const run = (argv: string[], env?: Record<string, string>) => new Promise<{ code: number; output: string }>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(`PTY did not finish: ${output}`)), 7000);
      startPty({ cwd: tmpdir(), argv, env }, {
        onData: (text) => { output += text; },
        onExit: (code) => { clearTimeout(timer); resolve({ code, output }); },
      });
    });
    const literal = await run(["/bin/echo", "$HOME;", "`id`"]);
    expect(literal).toMatchObject({ code: 0 });
    expect(literal.output).toContain("$HOME; `id`");
    const env = await run(["/usr/bin/printenv", "CAPSULE_PTY_PROBE"], { CAPSULE_PTY_PROBE: "signed-in" });
    expect(env.output).toContain("signed-in");
    expect((await run(["/usr/bin/false"])).code).not.toBe(0);
  });
});
