import { expect, it } from "vitest";
import { readToolActivityDetails } from "./tool-activity.js";
import { compactRunEvent } from "./run-events.js";

it("reads command, text content and locations without exposing opaque data", () => {
  expect(readToolActivityDetails({ rawInput: { command: "git status", token: "private" }, content: [
    { type: "content", content: { type: "image", data: "base64" } },
    { type: "content", content: { type: "text", text: "working tree clean" } },
  ], locations: [{ path: "/workspace/README.md", line: 3 }] })).toEqual({ input: "git status", output: "working tree clean", locations: ["/workspace/README.md"] });
  expect(readToolActivityDetails({ rawOutput: { unknown: "not a display field" } })).toEqual({});
});

it("preserves omitted fields, clears explicit empty content and respects reported output", () => {
  expect(readToolActivityDetails({ status: "completed", rawInput: null, rawOutput: null })).toEqual({});
  expect(readToolActivityDetails({ content: [], locations: [] })).toEqual({ output: "", locations: [] });
  expect(readToolActivityDetails({ content: [{ type: "content", content: { type: "image", data: "opaque" } }] })).toEqual({ output: "" });
  expect(readToolActivityDetails({ rawOutput: { stdout: "ok", stderr: "warning" } })).toEqual({ output: "ok\nwarning" });
});

it("bounds and sanitizes display text without rewriting code or path identities", () => {
  const details = readToolActivityDetails({ rawInput: "x".repeat(10000), rawOutput: "\u001b[31m<script>user: example</script>\u001b[0m", locations: [{ path: "x".repeat(513) }, { path: "bad\u0000.txt" }, { path: "safe.txt" }] });
  expect(details.input).toHaveLength(2048);
  expect(details.output).toBe("<script>user: example</script>");
  expect(details.locations).toEqual(["safe.txt"]);
  expect(details.truncated).toBe(true);
  expect(readToolActivityDetails({ details })).toEqual(details);
});

it("uses one output budget for many blocks and carries event truncation", () => {
  const details = readToolActivityDetails({ content: Array.from({ length: 200 }, () => ({ type: "content", content: { type: "text", text: "y".repeat(1000) } })) });
  expect(details.output!.length + details.outputTail!.length).toBeLessThanOrEqual(4096);
  expect(details.omittedLines).toBeGreaterThan(0);
  expect(details.truncated).toBe(true);
  expect(readToolActivityDetails({ payloadTruncated: true })).toEqual({ truncated: true });
});

it("keeps the end of a long log, where the error is, through saving and reading back", () => {
  const log = [...Array.from({ length: 300 }, (_, index) => `compiling module ${index}`), "error TS2322: Type 'string' is not assignable to type 'number'."].join("\n");
  const details = readToolActivityDetails({ rawOutput: { stdout: log, exit_code: 2 } });
  expect(details.output?.split("\n")[0]).toBe("compiling module 0");
  expect(details.outputTail?.split("\n").at(-1)).toBe("error TS2322: Type 'string' is not assignable to type 'number'.");
  expect(details.omittedLines).toBe(301 - details.output!.split("\n").length - details.outputTail!.split("\n").length);
  expect(details.exitCode).toBe(2);
  const saved = compactRunEvent({ id: "e", runId: "r", type: "tool", message: "pnpm build", timestamp: "2026-11-17T00:00:00Z", data: { toolCallId: "t", details } });
  expect(readToolActivityDetails(saved.data)).toEqual(details);
});

it("keeps short output whole and reports an exit code the route gives", () => {
  expect(readToolActivityDetails({ rawOutput: "ok\n", exitCode: 0 })).toEqual({ output: "ok\n", exitCode: 0 });
  expect(readToolActivityDetails({ rawOutput: { stdout: "", stderr: "boom", exitCode: 1 } })).toEqual({ output: "\nboom", exitCode: 1 });
  expect(readToolActivityDetails({ rawOutput: { exit_code: "1" } })).toEqual({});
});
