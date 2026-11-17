import { describe, expect, it } from "vitest";
import { fenceText, terminalCommandFrom } from "./shell-command";

describe("fenceText", () => {
  it("drops the newline that closes the fence's last line", () => {
    expect(fenceText("pnpm test\n")).toBe("pnpm test");
    expect(fenceText("a\nb\n")).toBe("a\nb");
  });
  it("keeps blank lines the author wrote", () => {
    expect(fenceText("a\n\n")).toBe("a\n");
  });
});

describe("terminalCommandFrom", () => {
  it("offers a closed one-line shell fence", () => {
    expect(terminalCommandFrom("pnpm test\n", "bash", true)).toBe("pnpm test");
    expect(terminalCommandFrom("$ git status\n", "console", true)).toBe("git status");
  });
  it("refuses a fence that is still streaming", () => {
    expect(terminalCommandFrom("rm -rf bu", "sh", false)).toBeUndefined();
  });
  it("refuses more than one line", () => {
    expect(terminalCommandFrom("cd app\npnpm test\n", "sh", true)).toBeUndefined();
  });
  it("refuses control characters and direction overrides", () => {
    expect(terminalCommandFrom("echo \u001b[2Khi\n", "sh", true)).toBeUndefined();
    expect(terminalCommandFrom("echo ‮evil\n", "sh", true)).toBeUndefined();
    expect(terminalCommandFrom("echo a\rb\n", "sh", true)).toBeUndefined();
  });
  it("refuses other languages", () => {
    expect(terminalCommandFrom("print(1)\n", "python", true)).toBeUndefined();
    expect(terminalCommandFrom("ls\n", undefined, true)).toBeUndefined();
  });
});
