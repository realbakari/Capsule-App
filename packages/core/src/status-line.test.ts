import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { CustomizationRunRecord, StatusLineRender } from "@capsule/shared";
import { runStatusLineCommand, StatusLineRunner } from "./status-line.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function folder() {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-status-line-"));
  dirs.push(dir);
  return dir;
}

it("feeds the thread as JSON on stdin and keeps two styled lines of what it prints", async () => {
  const cwd = folder();
  const script = path.join(cwd, "line.sh");
  writeFileSync(script, `input=$(cat)\nbranch=$(printf '%s' "$input" | sed -E 's/.*"branch":"([^"]*)".*/\\1/')\nprintf '\\033[32m%s\\033[0m ok\\nsecond\\nthird\\n' "$branch"\n`);
  const result = await runStatusLineCommand(`sh ${JSON.stringify(script)}`, { cwd, input: { branch: "main", thread_id: "t1" } });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.lines).toHaveLength(2);
  expect(result.lines[0]).toEqual([{ fg: "green", text: "main" }, { text: " ok" }]);
  expect(result.lines[1]).toEqual([{ text: "second" }]);
});

it("gives up after the timeout and says why", async () => {
  const result = await runStatusLineCommand("sleep 5", { cwd: folder(), input: {} }, { timeoutMs: 200 });
  expect(result).toMatchObject({ ok: false, failed: "timed out after 0.2s", exitCode: null });
});

it("reports a failing command with its exit code and stderr", async () => {
  const result = await runStatusLineCommand("echo broke >&2; exit 3", { cwd: folder(), input: {} });
  expect(result).toMatchObject({ ok: false, failed: "exit 3", exitCode: 3 });
  if (!result.ok) expect(result.stderr).toContain("broke");
});

it("collapses a burst of requests into one trailing run with the newest facts, and records a failure once", async () => {
  let clock = 0;
  const inputs: string[] = [];
  const renders: StatusLineRender[] = [];
  const records: CustomizationRunRecord[] = [];
  let fail = false;
  const run = vi.fn(async (_cwd: string, _command: string, options: { input: string }) => {
    inputs.push(options.input);
    return fail
      ? { stdout: "", stderr: "nope", code: 1, timedOut: false, durationMs: 1 }
      : { stdout: `${JSON.parse(options.input).n}\n`, stderr: "", code: 0, timedOut: false, durationMs: 1 };
  });
  const runner = new StatusLineRunner(
    { command: () => ({ command: "x", source: "settings.json" }), emit: (render) => { renders.push(render); }, record: (record) => { records.push(record); } },
    { now: () => clock, gapMs: 1000, run: run as never },
  );
  const job = (n: number) => ({ key: "t1", cwd: "/", input: { n } });
  runner.request(job(1));
  runner.request(job(2));
  runner.request(job(3));
  await vi.waitFor(() => expect(renders).toHaveLength(1));
  expect(inputs).toEqual(['{"n":1}']);
  clock = 1000;
  await vi.waitFor(() => expect(renders).toHaveLength(2), { timeout: 3000 });
  expect(inputs).toEqual(['{"n":1}', '{"n":3}']);
  expect(runner.latest("t1")?.lines).toEqual([[{ text: "3" }]]);
  fail = true;
  clock = 3000;
  runner.request(job(4));
  await vi.waitFor(() => expect(renders).toHaveLength(3));
  clock = 5000;
  runner.request(job(5));
  await vi.waitFor(() => expect(renders).toHaveLength(4));
  expect(renders.at(-1)).toMatchObject({ failed: "exit 1", lines: [[{ text: "3" }]] });
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ kind: "status-line", outcome: "exit 1", stderr: "nope" });
  runner.stop();
});
