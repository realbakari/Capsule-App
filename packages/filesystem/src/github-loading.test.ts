import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGhCache, listPullRequests, pollPullRequest, pollPullRequestList, pullRequestListFailure, readPullRequestDetail, readCommitDiff, viewPullRequest } from "./github.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({ ...await original<typeof import("node:child_process")>(), spawn: mocks.spawn }));
vi.mock("./avatars.js", () => ({ avatarsFor: async () => ({}) }));

const row = { number: 3, url: "https://github.com/example/repo/pull/3", title: "Fix login" };
let answers: { stdout?: string; stderr?: string; code?: number }[];

beforeEach(() => {
  clearGhCache();
  answers = [];
  mocks.spawn.mockReset().mockImplementation(() => {
    const answer = answers.shift();
    if (!answer) throw new Error("Unexpected process call in test");
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
    });
    setImmediate(() => {
      child.stdout.end(answer.stdout ?? "");
      child.stderr.end(answer.stderr ?? "");
      child.emit("close", answer.code ?? 0);
    });
    return child;
  });
});
afterEach(() => clearGhCache());

describe("GitHub read lifecycle", () => {
  it("keeps a successful list after repeated malformed output and allows recovery", async () => {
    answers.push({ stdout: JSON.stringify([row]) });
    expect(await listPullRequests("/repo")).toHaveLength(1);
    answers.push({ stdout: "[" }, { stdout: "[" });
    expect(await listPullRequests("/repo")).toBeUndefined();
    expect(pollPullRequestList("/repo").value?.[0]?.number).toBe(3);
    expect(pullRequestListFailure("/repo")).toMatch(/incomplete response/);
    answers.push({ stdout: "[]" });
    expect(await pollPullRequestList("/repo", true).pending).toEqual([]);
    expect(pullRequestListFailure("/repo")).toBeUndefined();
  });

  it("bypasses the cache only when requested and shares an in-flight refresh", async () => {
    answers.push({ stdout: JSON.stringify([row]) });
    await listPullRequests("/repo");
    expect(pollPullRequestList("/repo").pending).toBeUndefined();
    answers.push({ stdout: "[]" });
    const first = pollPullRequestList("/repo", true);
    const second = pollPullRequestList("/repo", true);
    expect(second.pending).toBe(first.pending);
    await first.pending;
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.spawn.mock.calls[0]?.[1].join(",")).not.toContain("statusCheckRollup");
  });

  it("surfaces a detail read failure instead of silently showing no details", async () => {
    answers.push({ code: 1, stderr: "unexpected end of JSON input" }, { stdout: "diff --git a/a b/a" }, { code: 1, stderr: "unexpected end of JSON input" });
    await expect(readPullRequestDetail("/repo", 3)).rejects.toThrow("incomplete response");
    expect(mocks.spawn).toHaveBeenCalledTimes(3);
  });

  it("keeps readable detail when only the patch fails", async () => {
    answers.push({ stdout: JSON.stringify(row) }, { code: 1, stderr: "maximum number of files" });
    expect(await readPullRequestDetail("/repo", 3)).toMatchObject({ number: 3, diff: "", diffUnavailable: expect.stringMatching(/this large/) });
  });

  it("distinguishes a missing current-branch PR from a failed read", async () => {
    answers.push({ code: 1, stderr: "no pull requests found for branch main" });
    expect(await viewPullRequest("/repo")).toBeUndefined();
    answers.push({ code: 1, stderr: "HTTP 401: Bad credentials" });
    await expect(viewPullRequest("/repo")).rejects.toThrow("signed in");
  });

  it("does not mark the branch's PR as known absent after a failed read", async () => {
    answers.push({ code: 1, stderr: "HTTP 401: Bad credentials" });
    expect(pollPullRequest("/repo").known).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    expect(pollPullRequest("/repo").known).toBe(false);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it("reads the selected commit without changing the checkout", async () => {
    answers.push({ stdout: "diff --git a/a b/a\n" });
    expect(await readCommitDiff("/repo", "a".repeat(40))).toContain("diff --git");
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn.mock.calls[0]?.[2]).toEqual({ cwd: "/repo" });
  });

  it("rejects invalid commit IDs before starting any process", async () => {
    await expect(readCommitDiff("/repo", "--help")).rejects.toThrow("full commit ID");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
