import fs from "node:fs";
import path from "node:path";
import {
  createId,
  nowIso,
  type ExecutionContract,
  type VerificationResult,
} from "@capsule/shared";

export function verifyContract(input: {
  contract: ExecutionContract;
  output: string;
  workingDirectory?: string;
  forceFail?: boolean;
}): VerificationResult {
  const checks = input.contract.required.map((requirement) => {
    if (input.forceFail) {
      return {
        requirementId: requirement.id,
        description: requirement.description,
        passed: false,
        detail: "Forced verification failure",
      };
    }
    if (requirement.kind === "output_contains" && requirement.value) {
      const passed = input.output.toLowerCase().includes(requirement.value.toLowerCase());
      return {
        requirementId: requirement.id,
        description: requirement.description,
        passed,
        detail: passed ? "Output contains required signal" : `Missing “${requirement.value}”`,
      };
    }
    if (requirement.kind === "files_exist" && requirement.value && input.workingDirectory) {
      const target = path.resolve(input.workingDirectory, requirement.value);
      const passed =
        target.startsWith(path.resolve(input.workingDirectory)) && fs.existsSync(target);
      return {
        requirementId: requirement.id,
        description: requirement.description,
        passed,
        detail: passed ? target : `File not found: ${requirement.value}`,
      };
    }
    return {
      requirementId: requirement.id,
      description: requirement.description,
      passed: input.output.trim().length > 0,
      detail: input.output.trim() ? "Completed" : "Empty result",
    };
  });

  const passed = checks.every((check) => check.passed);
  return {
    id: createId("ver"),
    runId: input.contract.runId ?? "",
    passed,
    summary: passed ? "Verification passed" : "Verification failed",
    checks,
    createdAt: nowIso(),
  };
}

export function evaluateRun(output: string, verification: VerificationResult): {
  summary: string;
  score: number;
} {
  if (!verification.passed) {
    return { summary: "The run finished but did not satisfy its contract.", score: 0.3 };
  }
  const lengthScore = Math.min(1, output.trim().length / 400);
  return {
    summary: "The run completed and satisfied the contract.",
    score: Math.round((0.7 + lengthScore * 0.3) * 100) / 100,
  };
}
