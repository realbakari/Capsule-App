import { expect, it } from "vitest";
import { readAgentCommands } from "./agent-commands.js";

it("normalizes bounded command reports, including explicit removal", () => {
  expect(readAgentCommands(undefined)).toBeUndefined();
  expect(readAgentCommands([])).toEqual([]);
  expect(readAgentCommands([{ name: "compact", description: "Compact context", input: { hint: "focus" } }, { name: "bad\nname" }])).toEqual([
    { name: "compact", description: "Compact context", inputHint: "focus" },
  ]);
  const commands = readAgentCommands(Array.from({ length: 100 }, (_, id) => ({ name: `command-${id}`, description: "x".repeat(1000) })))!;
  expect(commands).toHaveLength(64);
  expect(commands[0]!.description.length).toBeLessThanOrEqual(256);
});
