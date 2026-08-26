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

describe("advisory checks do not fail a run", () => {
  it("passes a code-mode run whose prose lacks the keyword", () => {
    const contract = buildContract({ mode: "code", prompt: "review this readme", runId: "run_1" });
    const result = verifyContract({
      contract,
      // A genuinely useful answer that never says the word "files".
      output: "The README is templated and consistent with the other folders.",
    });
    expect(result.passed).toBe(true);
    const advisory = result.checks.find((c) => c.requirementId === "describe-changes");
    expect(advisory?.advisory).toBe(true);
    expect(advisory?.passed).toBe(false);
  });

  it("still fails on an objective check", () => {
    const result = verifyContract({
      contract: {
        id: "c1",
        runId: "run_1",
        humanSummary: "",
        required: [
          { id: "f", description: "file exists", kind: "files_exist", value: "does-not-exist.txt" },
        ],
        forbidden: [],
      },
      output: "done",
      workingDirectory: process.cwd(),
    });
    expect(result.passed).toBe(false);
  });

  it("does not treat a sibling directory as inside the working directory", () => {
    const result = verifyContract({
      contract: {
        id: "c2",
        runId: "run_1",
        humanSummary: "",
        required: [
          { id: "f", description: "escape", kind: "files_exist", value: "../package.json" },
        ],
        forbidden: [],
      },
      output: "done",
      workingDirectory: process.cwd(),
    });
    expect(result.passed).toBe(false);
  });
});
