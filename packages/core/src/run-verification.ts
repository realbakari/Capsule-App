import { inRepository, readWorktreeRevision } from "@capsule/filesystem";
import { nowIso, type ExecutionContract, type ProjectAction, type Run, type VerificationEvidence, type VerificationResult } from "@capsule/shared";
import { runInDirectory } from "@capsule/terminal";
import { sameRevision, verifyContract } from "@capsule/verification";

/** Explicit local checks. Neither runtime route may certify itself through prose. */
export async function checkRun(input: {
  run: Run;
  contract: ExecutionContract;
  action?: ProjectAction;
  signal?: AbortSignal;
  assertIdle: () => void;
  started: (result: VerificationResult) => void;
}): Promise<VerificationResult> {
  const { run, contract, action } = input;
  const evaluate = (evidence?: VerificationEvidence) => verifyContract({ contract, output: run.result ?? "", revision: run.revision, evidence });
  if (!run.workingDirectory || !run.revision) {
    return { ...evaluate(undefined), status: "unverified", passed: false, summary: "Not verified: this turn has no saved local workspace revision." };
  }
  return inRepository(run.workingDirectory, async () => {
    input.assertIdle();
    const before = await readWorktreeRevision(run.workingDirectory!);
    if (!sameRevision(run.revision, before)) {
      return { ...evaluate(run.verification?.evidence), status: "stale", passed: false, summary: "Workspace has changed since this turn. Restore it or check a newer turn." };
    }
    if (!action) return verifyContract({ contract, output: run.result ?? "", revision: run.revision, evidence: run.verification?.evidence, workingDirectory: before.cwd });
    const startedAt = nowIso();
    input.started({ ...evaluate(undefined), evidence: undefined, status: "unverified", passed: false, inProgress: true, summary: "Check started; no completed evidence yet." });
    let exitCode: number | undefined;
    let output = "";
    try {
      const result = await runInDirectory(before.cwd, action.command, 120_000, input.signal);
      exitCode = result.code;
      output = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(-20_000);
    } catch (error) {
      output = error instanceof Error ? error.message : String(error);
    }
    let after;
    try { after = await readWorktreeRevision(before.cwd); } catch { /* Cannot certify a missing final snapshot. */ }
    const evidence: VerificationEvidence = { runId: run.id, actionId: action.id, command: action.command, revision: before, after, exitCode, output, startedAt, completedAt: nowIso() };
    return verifyContract({ contract, output: run.result ?? "", revision: run.revision, evidence, workingDirectory: after?.cwd });
  });
}
