import { describe, expect, it } from "vitest";
import { outputTail, runCapped, runInDirectory, terminalAppleScript } from "./index.js";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
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
    try {
      const result = await runInDirectory(dir, process.platform === "win32" ? "(Get-Location).Path" : "pwd");
      expect(result.code).toBe(0);
      // PowerShell expands 8.3 aliases such as RUNNER~1. Compare native paths,
      // not two spellings of the same directory.
      expect(realpathSync.native(result.stdout.trim())).toBe(realpathSync.native(dir));
    } finally { rmSync(dir, { recursive: true, force: true }); }
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

describe("runCapped", () => {
  it.skipIf(process.platform === "win32")("keeps the first bytes of both streams, in order, and the exit code", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-capped-"));
    try {
      const failed = await runCapped(dir, "echo out; sleep 0.2; echo err >&2; exit 3", { timeoutMs: 10_000, maxBytes: 1024 });
      expect(failed).toMatchObject({ output: "out\nerr\n", code: 3, timedOut: false, truncated: false });
      const long = await runCapped(dir, "head -c 40000 /dev/zero | tr '\\0' x", { timeoutMs: 10_000, maxBytes: 16 * 1024 });
      expect(long).toMatchObject({ code: 0, truncated: true });
      expect(long.output).toBe("x".repeat(16 * 1024));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("stops a command at its time limit and keeps what it printed", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-capped-"));
    try {
      const result = await runCapped(dir, "echo started; sleep 30", { timeoutMs: 500, maxBytes: 1024 });
      expect(result).toMatchObject({ output: "started\n", code: null, timedOut: true });
      expect(result.durationMs).toBeLessThan(10_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
