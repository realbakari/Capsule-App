import fs from "node:fs";
import path from "node:path";
import { createId, nowIso, type ExecutionContract, type VerificationEvidence, type VerificationResult, type WorkspaceRevision } from "@capsule/shared";

export function sameRevision(a?: WorkspaceRevision, b?: WorkspaceRevision): boolean {
  return Boolean(a && b && a.cwd === b.cwd && a.head === b.head && a.tree === b.tree);
}

/** Agent prose is never evidence that a command ran or that tests passed. */
export function verifyContract(input: {
  contract: ExecutionContract;
  output: string;
  workingDirectory?: string;
  revision?: WorkspaceRevision;
  evidence?: VerificationEvidence;
  forceFail?: boolean;
}): VerificationResult {
  const evidence = input.evidence;
  const belongs = evidence?.runId === input.contract.runId && sameRevision(input.revision, evidence?.revision);
  const stable = belongs && sameRevision(evidence?.revision, evidence?.after);
  const checks: VerificationResult["checks"] = input.contract.required.map((requirement) => {
    const base = { requirementId: requirement.id, description: requirement.description };
    if (input.forceFail) return { ...base, status: "failed", passed: false, detail: "Forced verification failure" };
    if (requirement.kind === "output_contains" && requirement.value) {
      const passed = input.output.toLowerCase().includes(requirement.value.toLowerCase());
      return { ...base, status: "unverified", passed, advisory: true, detail: "Prose hint only; not verification evidence." };
    }
    if (requirement.kind === "tests_pass") {
      if (!evidence || !belongs || (requirement.value && ![evidence.actionId, evidence.command].includes(requirement.value))) {
        return { ...base, status: "unverified", passed: false, detail: "No matching saved check has run for this turn and revision." };
      }
      if (!stable) return { ...base, status: "stale", passed: false, detail: "The workspace changed during the check, or its final revision could not be recorded." };
      if (evidence.exitCode === undefined) return { ...base, status: "unverified", passed: false, detail: "The check did not produce an exit code." };
      return { ...base, status: evidence.exitCode === 0 ? "passed" : "failed", passed: evidence.exitCode === 0, detail: evidence.command + " exited " + evidence.exitCode + "." };
    }
    if (requirement.kind === "files_exist" && requirement.value && input.workingDirectory && stable && input.workingDirectory === evidence?.after?.cwd) {
      let passed = false;
      try {
        const root = fs.realpathSync(input.workingDirectory);
        const target = fs.realpathSync(path.resolve(root, requirement.value));
      const relative = path.relative(root, target);
        passed = !relative.startsWith("..") && !path.isAbsolute(relative);
      } catch { /* Missing files fail; symlinks cannot escape the root. */ }
      return { ...base, passed, status: passed ? "passed" : "failed", detail: passed ? requirement.value : "File not found in workspace: " + requirement.value };
    }
    return { ...base, status: "unverified", passed: false, advisory: requirement.kind === "custom", detail: "Requires human review or recorded evidence; a reply is not proof." };
  });
  const decisive = checks.filter((check) => !check.advisory);
  const status = decisive.some((c) => c.status === "stale") ? "stale"
    : decisive.some((c) => c.status === "failed") ? "failed"
      : decisive.length > 0 && decisive.every((c) => c.status === "passed") ? "passed" : "unverified";
  return {
    id: createId("ver"), runId: input.contract.runId ?? "", passed: status === "passed", status,
    summary: status === "passed" ? "Recorded checks passed" : status === "failed" ? "Checks failed" : status === "stale" ? "Check evidence is stale" : "Not verified",
    checks, evidence, createdAt: nowIso(),
  };
}

export function evaluateRun(_output: string, verification: VerificationResult): { summary: string; score?: number; } {
  // Reply length says nothing about correctness. Do not invent a quality score.
  return { summary: verification.summary };
}
