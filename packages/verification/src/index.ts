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
      // A substring grep over the agent's prose is a hint, not a verdict. A
      // correct, useful answer that happens not to contain the keyword used to
      // mark the whole run failed.
      const passed = input.output.toLowerCase().includes(requirement.value.toLowerCase());
      return {
        requirementId: requirement.id,
        description: requirement.description,
        passed,
        advisory: true,
        detail: passed ? "Output contains required signal" : `Missing “${requirement.value}”`,
      };
    }
    if (requirement.kind === "files_exist" && requirement.value && input.workingDirectory) {
      const root = path.resolve(input.workingDirectory);
      const target = path.resolve(root, requirement.value);
      // Same containment rule as FilesystemAdapter: a raw prefix test also
      // matches siblings that merely start with the root's name.
      const relative = path.relative(root, target);
      const inside = !relative.startsWith("..") && !path.isAbsolute(relative);
      const passed = inside && fs.existsSync(target);
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

  // Only objective checks decide the verdict; advisory ones are reported.
  const decisive = checks.filter((check) => !check.advisory);
  const passed = decisive.every((check) => check.passed);
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
