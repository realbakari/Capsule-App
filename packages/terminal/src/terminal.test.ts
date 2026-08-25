import { describe, expect, it } from "vitest";
import { runInDirectory, terminalAppleScript } from "./index.js";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("terminal helpers", () => {
  it("builds AppleScript that cds via argv", () => {
    const terminal = terminalAppleScript("Terminal");
    expect(terminal).toContain('tell application "Terminal"');
    expect(terminal).toContain("quoted form of thePath");
    expect(terminal).toContain("do script");
    const iterm = terminalAppleScript("iTerm");
    expect(iterm).toContain('tell application "iTerm"');
    expect(iterm).toContain("write text");
  });

  it("runs a command in a directory", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-term-"));
    const result = await runInDirectory(dir, "pwd");
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(realpathSync(dir));
  });
});
