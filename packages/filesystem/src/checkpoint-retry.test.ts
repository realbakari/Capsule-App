import { afterEach, expect, it, vi } from "vitest";
import { checkpointGit } from "./checkpoint-retry.js";
import { git } from "./git-process.js";
vi.mock("./git-process.js", () => ({ git: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

const locked = { ok: false, stdout: "", stderr: "fatal: Unable to create '/repo/.git/index.lock': File exists", exitCode: 128 };
it("bounds transient snapshot lock retries", async () => {
  vi.useFakeTimers();
  vi.mocked(git).mockResolvedValue(locked);
  const pending = checkpointGit("/repo", ["update-ref", "refs/capsule/checkpoints/fixture", "oid"]);
  await vi.runAllTimersAsync();
  expect(await pending).toEqual(locked);
  expect(git).toHaveBeenCalledTimes(3);
});

it.each([
  ["restore", locked],
  ["add", { ...locked, exitCode: undefined }],
  ["write-tree", { ...locked, stderr: "fatal: invalid object" }],
])("does not retry unsafe or nontransient %s failures", async (command, result) => {
  vi.mocked(git).mockResolvedValue(result);
  expect(await checkpointGit("/repo", [command])).toEqual(result);
  expect(git).toHaveBeenCalledTimes(1);
});
