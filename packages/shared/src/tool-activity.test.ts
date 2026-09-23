import { expect, it } from "vitest";
import { readToolActivityDetails } from "./tool-activity.js";

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
  expect(details.output).toHaveLength(2048);
  expect(details.truncated).toBe(true);
  expect(readToolActivityDetails({ payloadTruncated: true })).toEqual({ truncated: true });
});
