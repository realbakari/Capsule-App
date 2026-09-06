import { expect, it } from "vitest";
import { outboundFrame } from "./outbound.js";

it("counts bytes and rejects an oversized event rather than queuing it", () => {
  expect(outboundFrame({ type: "event", payload: "☀".repeat(100) }, 250)).toBeUndefined();
});
it("answers oversized RPC results with their ID and an action-safe error", () => {
  const frame = JSON.parse(outboundFrame({ type: "result", id: 42, result: "x".repeat(1_000) }, 500)!);
  expect(frame.id).toBe(42);
  expect(frame.error).toMatch(/check its result before retrying/);
  expect(frame.result).toBeUndefined();
});
