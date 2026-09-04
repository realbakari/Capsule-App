import { describe, expect, it } from "vitest";
import { buildContract } from "@capsule/contracts";
import { verifyContract } from "./index.js";
import type { VerificationEvidence, WorkspaceRevision } from "@capsule/shared";

describe("evidence identity", () => {
  const revision: WorkspaceRevision = { cwd: "/repo", head: "head", tree: "tree" };
  const evidence: VerificationEvidence = { runId: "r", actionId: "test", command: "pnpm test", revision, after: revision, exitCode: 0, output: "", startedAt: "start", completedAt: "end" };
  const contract = buildContract({ mode: "code", prompt: "change", runId: "r" });
  it("rejects another run's evidence", () => {
    expect(verifyContract({ contract, output: "all tests pass", revision, evidence: { ...evidence, runId: "another" } }).status).toBe("unverified");
  });
  it("rejects identical trees in a different directory or HEAD", () => {
    for (const changed of [{ ...revision, cwd: "/other" }, { ...revision, head: "other" }]) {
      expect(verifyContract({ contract, output: "done", revision: changed, evidence }).status).toBe("unverified");
    }
  });
  it("does not award a pass to empty or human-only requirements", () => {
    expect(verifyContract({ contract: { ...contract, required: [] }, output: "done", revision, evidence }).status).toBe("unverified");
    expect(verifyContract({ contract: buildContract({ mode: "chat", prompt: "hi" }), output: "done" }).status).toBe("unverified");
  });
});

describe("verifyContract", () => {
  it("does not certify a reply that says tests were not run", () => {
    const contract = buildContract({
      mode: "code",
      prompt: "Add a route",
      runId: "run_1",
    });
    const result = verifyContract({
      contract,
      output: "Changed files: src/router.ts. Tests were not run.",
    });
    expect(result.status).toBe("unverified");
    expect(result.passed).toBe(false);
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
  it("leaves a code-mode run unverified rather than failing on prose", () => {
    const contract = buildContract({ mode: "code", prompt: "review this readme", runId: "run_1" });
    const result = verifyContract({
      contract,
      // A genuinely useful answer that never says the word "files".
      output: "The README is templated and consistent with the other folders.",
    });
    expect(result.status).toBe("unverified");
    expect(result.passed).toBe(false);
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
