import { describe, expect, it, vi } from "vitest";
import { INCOMPLETE_GITHUB_RESPONSE, readGhJson, type CommandResult } from "./github-read.js";

function decode(raw: string): unknown[] | undefined {
  try {
    const result: unknown = JSON.parse(raw);
    return Array.isArray(result) ? result : undefined;
  } catch {
    return undefined;
  }
}
const ok = (stdout: string): CommandResult => ({ ok: true, stdout, stderr: "" });
const fail = (stderr: string): CommandResult => ({ ok: false, stdout: "", stderr });

describe("bounded GitHub JSON reads", () => {
  it("never runs a write command through the retry path", async () => {
    const run = vi.fn();
    await expect(readGhJson(["pr", "create"], "/repo", decode, run)).rejects.toThrow("restricted to pull request reads");
    expect(run).not.toHaveBeenCalled();
  });
  it("retries gh's decoder failure once and returns the complete response", async () => {
    const run = vi.fn().mockResolvedValueOnce(fail("unexpected end of JSON input")).mockResolvedValueOnce(ok('[{"number":3}]'));
    const result = await readGhJson(["pr", "list", "--json", "number"], "/repo", decode, run);
    expect(result.value).toEqual([{ number: 3 }]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.slice(0, 3)).toEqual(run.mock.calls[0]?.slice(0, 3));
  });

  it.each(["", "[", '{"error":"bad gateway"}'])("recovers from malformed successful output %j", async (raw) => {
    const run = vi.fn().mockResolvedValueOnce(ok(raw)).mockResolvedValueOnce(ok("[]"));
    expect(await readGhJson(["pr", "list"], "/repo", decode, run)).toEqual({ value: [] });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps repeated decode failure separate from a valid empty list", async () => {
    const run = vi.fn().mockResolvedValue(ok("["));
    expect(await readGhJson(["pr", "list"], "/repo", decode, run)).toEqual({ error: INCOMPLETE_GITHUB_RESPONSE });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not retry a valid empty list", async () => {
    const run = vi.fn().mockResolvedValue(ok("[]"));
    expect(await readGhJson(["pr", "list"], "/repo", decode, run)).toEqual({ value: [] });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(["gh auth login", "HTTP 403: API rate limit exceeded", "HTTP 404: Not Found", "ENOENT"])("does not retry a persistent failure: %s", async (error) => {
    const run = vi.fn().mockResolvedValue(fail(error));
    expect(await readGhJson(["pr", "view"], "/repo", decode, run)).toEqual({ error });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries a temporary host failure, not indefinitely", async () => {
    const run = vi.fn().mockResolvedValue(fail("HTTP 502: bad gateway"));
    expect((await readGhJson(["pr", "list"], "/repo", decode, run)).error).toContain("502");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("shares one timeout budget rather than doubling the wait", async () => {
    const time = vi.spyOn(Date, "now");
    time.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(9_000).mockReturnValueOnce(9_000);
    const run = vi.fn().mockResolvedValueOnce(ok("[")).mockResolvedValueOnce(ok("[]"));
    try {
      await readGhJson(["pr", "list"], "/repo", decode, run, 10_000);
      expect(run.mock.calls.map((call) => call[3])).toEqual([10_000, 1_000]);
    } finally {
      time.mockRestore();
    }
  });
});
