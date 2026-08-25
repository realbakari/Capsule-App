import { describe, expect, it } from "vitest";
import { buildContract } from "@capsule/contracts";
import { verifyContract } from "./index.js";

describe("verifyContract", () => {
  it("passes when required output is present", () => {
    const contract = buildContract({
      mode: "code",
      prompt: "Add a route",
      runId: "run_1",
    });
    const result = verifyContract({
      contract,
      output: "Changed files: src/router.ts. Tests were not run.",
    });
    expect(result.passed).toBe(true);
  });

  it("fails when forced", () => {
    const contract = buildContract({ mode: "chat", prompt: "Hello", runId: "run_2" });
    const result = verifyContract({
      contract,
      output: "Hello",
      forceFail: true,
    });
    expect(result.passed).toBe(false);
  });
});
