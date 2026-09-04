import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readWorktreeRevision, captureCheckpoint } from "@capsule/filesystem";
import { buildContract } from "@capsule/contracts";
import type { Run } from "@capsule/shared";
import { checkRun } from "./run-verification.js";

async function fixture() {
  const cwd = mkdtempSync(path.join(tmpdir(), "capsule-evidence-"));
  execFileSync("git", ["init", "-q"], { cwd });
  writeFileSync(path.join(cwd, "source.txt"), "before\n");
  const revision = await readWorktreeRevision(cwd);
  const run: Run = { id: "run", sessionId: "thread", projectId: "project", agentId: "general", status: "completed", prompt: "change", workingDirectory: cwd, revision, createdAt: "2026-09-04T00:00:00Z", updatedAt: "2026-09-04T00:00:00Z" };
  return { cwd, run, contract: buildContract({ mode: "code", prompt: "change", runId: run.id }), assertIdle: vi.fn(), started: vi.fn() };
}

describe("local verification receipts", () => {
  it("only passes an executed check for the saved tree; the real staging area stays unchanged", async () => {
    const input = await fixture();
    expect((await checkRun(input)).status).toBe("unverified");
    const before = execFileSync("git", ["ls-files", "--stage"], { cwd: input.cwd, encoding: "utf8" });
    const result = await checkRun({ ...input, action: { id: "test", name: "Test", command: "printf 'checks passed'" } });
    expect(result.status).toBe("passed"); expect(result.evidence?.exitCode).toBe(0);
    expect(result.evidence?.revision).toEqual(input.run.revision); expect(result.evidence?.output).toContain("checks passed");
    expect(input.started).toHaveBeenCalledWith(expect.objectContaining({ status: "unverified", evidence: undefined }));
    expect(execFileSync("git", ["ls-files", "--stage"], { cwd: input.cwd, encoding: "utf8" })).toBe(before);
  });
  it("records a nonzero exit without changing the completed turn", async () => {
    const input = await fixture();
    const result = await checkRun({ ...input, action: { id: "test", name: "Test", command: "echo 'not okay'; exit 7" } });
    expect(result.status).toBe("failed"); expect(result.evidence?.exitCode).toBe(7); expect(input.run.status).toBe("completed");
  });
  it("refuses to run against newer work and keeps the previous receipt historical", async () => {
    const input = await fixture(); writeFileSync(path.join(input.cwd, "source.txt"), "newer\n");
    const result = await checkRun({ ...input, action: { id: "test", name: "Test", command: "printf wrong > source.txt" } });
    expect(result.status).toBe("stale"); expect(input.started).not.toHaveBeenCalled();
    expect(readFileSync(path.join(input.cwd, "source.txt"), "utf8")).toBe("newer\n");
  });
  it("does not certify a check that modified tracked or untracked files", async () => {
    const input = await fixture();
    const result = await checkRun({ ...input, action: { id: "test", name: "Test", command: "printf after > source.txt" } });
    expect(result.status).toBe("stale"); expect(result.evidence?.exitCode).toBe(0); expect(result.passed).toBe(false);
  });
  it("records cancellation as unverified, never a pass", async () => {
    const input = await fixture(); const controller = new AbortController(); controller.abort();
    const result = await checkRun({ ...input, signal: controller.signal, action: { id: "test", name: "Test", command: "exit 0" } });
    expect(result.status).toBe("unverified"); expect(result.evidence?.exitCode).toBeUndefined(); expect(result.evidence?.output).toMatch(/cancelled/i);
  });
  it("does not substitute the project folder for an older turn without a revision", async () => {
    const input = await fixture(); input.run.revision = undefined;
    expect((await checkRun(input)).status).toBe("unverified"); expect(input.assertIdle).not.toHaveBeenCalled();
  });
  it("captures the same revision in the checkpoint receipt", async () => {
    const input = await fixture();
    const saved = await captureCheckpoint(input.cwd, "refs/capsule/test");
    expect(saved.ok).toBe(true); expect(saved.revision).toEqual(input.run.revision);
  });
});
