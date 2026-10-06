import { expect, it } from "vitest";
import { nativeToolDetails } from "./tool-details.js";

it("keeps command input and bounded, literal output", () => {
  expect(nativeToolDetails({ type: "commandExecution", command: "printf '<div>'", aggregatedOutput: "\u001b[31m<div>" }))
    .toEqual({ input: "printf '<div>'", output: "<div>" });
  expect(nativeToolDetails({ type: "commandExecution", aggregatedOutput: "x".repeat(3000) }))
    .toEqual({ output: "x".repeat(2048), truncated: true });
});

it("shows file changes and textual tool results without dumping image payloads", () => {
  expect(nativeToolDetails({ type: "fileChange", changes: [{ path: "src/app.ts", diff: "+hello" }] }))
    .toEqual({ output: "+hello", locations: ["src/app.ts"] });
  expect(nativeToolDetails({ type: "mcpToolCall", result: { content: [
    { type: "image", data: "private-binary" }, { type: "text", text: "Found two rows" },
  ] } })).toEqual({ output: "Found two rows" });
  expect(nativeToolDetails({ type: "mcpToolCall", result: { content: [] }, error: { message: "Connection refused" } })).toEqual({ output: "Connection refused" });
  expect(nativeToolDetails({ type: "mcpToolCall", result: { content: Array.from({ length: 40 }, () => ({ type: "text", text: "one" })) } }))
    .toEqual({ output: Array.from({ length: 32 }, () => "one").join("\n"), truncated: true });
});
