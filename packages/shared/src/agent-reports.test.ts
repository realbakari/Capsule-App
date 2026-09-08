import { expect, it } from "vitest";
import { readAgentCapabilities, readReportedContextUsage, readReportedTurnUsage } from "./agent-reports.js";

it("retains negotiated facts without turning absence into support", () => {
  expect(readAgentCapabilities({ agentInfo: { name: "Fixture", version: "1" }, agentCapabilities: { promptCapabilities: { image: false }, mcpCapabilities: { http: true } } })).toMatchObject({ name: "Fixture", images: false, httpMcp: true });
  expect(readAgentCapabilities({}).images).toBeUndefined();
});

it("bounds option count, choices and labels", () => {
  const report = readAgentCapabilities({}, Array.from({ length: 1000 }, () => ({ id: "model", type: "select", name: "x".repeat(1000), options: Array.from({ length: 1000 }, () => ({ value: "v", name: "n" })) })));
  expect(report.configOptions).toHaveLength(16);
  expect(report.configOptions[0]?.choices).toHaveLength(32);
  expect(report.configOptions[0]?.name.length).toBe(128);
  expect(JSON.stringify(report).length).toBeLessThan(256000);
});

it("treats context as a snapshot, rejects invalid counts and does not invent totals", () => {
  const report = { used: 12, size: 100, cost: { amount: 0.5, currency: "USD" } };
  expect(readReportedContextUsage(report)).toEqual({ ...report, source: "agent" });
  expect(readReportedContextUsage({ used: -1, size: 100 })).toBeUndefined();
  expect(readReportedContextUsage({ used: 1, size: 0 })).toBeUndefined();
  expect(readReportedTurnUsage({ inputTokens: 5, outputTokens: NaN, totalTokens: -4 })).toEqual({ source: "agent", inputTokens: 5 });
});

it("reads grouped model choices with a shared bound and no recursive expansion", () => {
  const options = [
    { group: "fast", name: "Fast", options: [{ value: "small", name: "Small", description: "Quick tasks" }] },
    { group: "reasoning", name: "Reasoning", options: [{ value: "large", name: "Large" }] },
  ];
  const report = (options: unknown) => readAgentCapabilities({}, [{ id: "model", type: "select", options }]).configOptions[0]!;
  expect(report(options).choices).toEqual([
    { value: "small", name: "Small", description: "Quick tasks" },
    { value: "large", name: "Large", description: undefined },
  ]);
  const large = Array.from({ length: 100 }, (_, index) => ({ group: String(index), options: Array.from({ length: 100 }, () => ({ value: "model" })) }));
  expect(report(large).choices).toHaveLength(32);
  expect(report([{ group: "outer", options }]).choices).toEqual([]);
});

it("does not rewrite model or configuration identifiers into another choice", () => {
  const longId = "x".repeat(129);
  const report = readAgentCapabilities({}, [
    { id: longId, type: "select", options: [] },
    { id: "model", type: "select", currentValue: longId, options: [
      { value: longId }, { value: "mo\ndel" }, { value: "valid", name: "Label" },
    ] },
  ]);
  expect(report.configOptions).toHaveLength(1);
  expect(report.configOptions[0]?.currentValue).toBeUndefined();
  expect(report.configOptions[0]?.choices).toEqual([{ value: "valid", name: "Label", description: undefined }]);
});
