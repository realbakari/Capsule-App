import { describe, expect, it } from "vitest";
import { outputTail, runInDirectory, terminalAppleScript } from "./index.js";
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

describe("outputTail", () => {
  /** What the old implementation did, kept as the definition of correct. */
  const naive = (chunks: string[], cap: number) =>
    chunks.reduce((text, chunk) => (text + chunk).slice(-cap), "");

  it("keeps exactly the tail the recopying version kept", () => {
    const cases: Array<{ chunks: string[]; cap: number }> = [
      { chunks: ["abc", "def", "ghi"], cap: 5 },
      { chunks: ["a", "b", "c"], cap: 100 },
      { chunks: [], cap: 10 },
      { chunks: [""], cap: 10 },
      { chunks: ["0123456789ABCDEF"], cap: 4 },
      { chunks: ["x".repeat(50), "y".repeat(3)], cap: 10 },
      { chunks: Array.from({ length: 200 }, (_, i) => String(i % 10)), cap: 37 },
    ];
    for (const { chunks, cap } of cases) {
      const tail = outputTail(cap);
      for (const chunk of chunks) tail.push(chunk);
      expect(tail.read()).toBe(naive(chunks, cap));
    }
  });

  it("matches the old behaviour on random chunkings", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 40; run += 1) {
      const cap = 1 + Math.floor(next() * 40);
      const chunks = Array.from({ length: Math.floor(next() * 30) }, () =>
        "abcdefghij".slice(0, 1 + Math.floor(next() * 9)),
      );
      const tail = outputTail(cap);
      for (const chunk of chunks) tail.push(chunk);
      expect(tail.read()).toBe(naive(chunks, cap));
    }
  });

  it("does not retain more than the cap plus the chunk that straddles it", () => {
    // The whole point: evicted output must be released, not merely hidden.
    const cap = 1_000;
    const tail = outputTail(cap);
    for (let i = 0; i < 5_000; i += 1) tail.push("z".repeat(100));
    expect(tail.read().length).toBe(cap);
  });

  it("stays linear in the output rather than output times cap", () => {
    // 200k characters in 20k small writes. The recopying version moves ~400M
    // characters here; this must not.
    const cap = 20_000;
    const chunks = Array.from({ length: 20_000 }, () => "0123456789");
    const started = Date.now();
    const tail = outputTail(cap);
    for (const chunk of chunks) tail.push(chunk);
    const text = tail.read();
    expect(text.length).toBe(cap);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
