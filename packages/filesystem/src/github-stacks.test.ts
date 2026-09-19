import { describe, expect, it } from "vitest";
import {
  enrichPullRequestsWithStacks,
  expectedHeadsFromLayers,
  githubRepoFromPullRequestUrl,
  githubRepoFromRemote,
  headsMatch,
  isTopStackLayer,
  mergeLayersThrough,
  mergePullRequestStack,
  mergeStackArgs,
  mergeStackPollArgs,
  parsePullRequestStacksJson,
  parseStackMembershipsJson,
  sameGithubRepo,
  stackLayerLabel,
  stackMembershipQuery,
} from "./github-stacks.js";
import type { ReadCommand } from "./github-read.js";
import type { GitPullRequestStack } from "@capsule/shared";

const stack: GitPullRequestStack = {
  number: 9,
  base: "main",
  layers: [
    { number: 1, title: "Base", headBranch: "feat/one", headSha: "a".repeat(40), state: "open" },
    { number: 2, title: "Middle", headBranch: "feat/two", headSha: "b".repeat(40), state: "open", isDraft: true },
    { number: 3, title: "Top", headBranch: "feat/three", headSha: "c".repeat(40), state: "open" },
  ],
};

describe("GitHub stack parsing", () => {
  it("reads owner and repo from a pull request URL and ignores other hosts", () => {
    expect(githubRepoFromPullRequestUrl("https://github.com/acme/web/pull/7")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "web",
    });
    expect(githubRepoFromPullRequestUrl("https://www.github.com/acme/web/pull/7/files")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "web",
    });
    expect(githubRepoFromPullRequestUrl("https://github.acme.test/acme/web/pull/7")).toMatchObject({
      host: "github.acme.test",
    });
    expect(githubRepoFromPullRequestUrl("https://github.com/../web/pull/7")).toBeUndefined();
  });

  it("refuses to put an untrusted repository name into a GraphQL document", () => {
    expect(stackMembershipQuery({ host: "github.com", owner: 'acme") { x } #', repo: "web" }, [1])).toBeUndefined();
    expect(stackMembershipQuery({ host: "github.com", owner: "acme", repo: "web" }, [0])).toBeUndefined();
    expect(stackMembershipQuery({ host: "github.acme.test", owner: "acme", repo: "web" }, [1])).toBeUndefined();
    expect(stackMembershipQuery({ host: "github.com", owner: "acme", repo: "web" }, [4, 5])).toContain("pullRequest(number: 4)");
  });

  it("maps aliased membership rows and skips incomplete ones", () => {
    const memberships = parseStackMembershipsJson(
      JSON.stringify({
        data: {
          s0: { pullRequest: { stack: { number: 3, size: 2, baseRefName: "main" }, stackEntry: { position: 1 } } },
          s1: { pullRequest: { stack: null, stackEntry: null } },
          s2: null,
        },
      }),
      [4, 5, 6],
    );
    expect([...memberships]).toEqual([[4, { number: 3, size: 2, base: "main", position: 1 }]]);
  });

  it("keeps layer titles, draft state and expected revisions from a stack payload", () => {
    expect(
      parsePullRequestStacksJson(
        JSON.stringify({
          number: 3,
          url: "https://api.github.com/repos/acme/web/stacks/3",
          base: { ref: "main" },
          pull_requests: [
            { number: 7, title: "First", draft: false, head: { ref: "feat/one", sha: "abc1234" }, state: "open", merged_at: null },
            { number: 8, title: "Second", draft: true, head: { ref: "feat/two", sha: "def5678" }, state: "OPEN", merged_at: null },
          ],
        }),
      ),
    ).toEqual({
      number: 3,
      url: "https://api.github.com/repos/acme/web/stacks/3",
      base: "main",
      layers: [
        { number: 7, title: "First", isDraft: false, headSha: "abc1234", headBranch: "feat/one", state: "open" },
        { number: 8, title: "Second", isDraft: true, headSha: "def5678", headBranch: "feat/two", state: "open" },
      ],
    });
    expect(parsePullRequestStacksJson("[]")).toBeUndefined();
    expect(parsePullRequestStacksJson("{")).toBeUndefined();
  });
});

describe("GitHub stack actions", () => {
  it("merges from the base through the selected open layer and refuses a draft in that set", () => {
    expect(mergeLayersThrough(stack, 1)?.map((layer) => layer.number)).toEqual([1]);
    expect(mergeLayersThrough(stack, 2)).toBeUndefined();
    expect(mergeLayersThrough({ ...stack, layers: stack.layers.map((layer) => ({ ...layer, isDraft: false })) }, 3)?.map((layer) => layer.number)).toEqual([1, 2, 3]);
    expect(mergeLayersThrough({
      ...stack,
      layers: [
        { ...stack.layers[0]!, state: "closed" },
        { ...stack.layers[1]!, isDraft: false },
      ],
    }, 2)).toBeUndefined();
    expect(isTopStackLayer(stack, 3)).toBe(true);
    expect(isTopStackLayer(stack, 1)).toBe(false);
    expect(stackLayerLabel({ number: 9, size: 16, position: 3, base: "main" })).toBe("3/16");
  });

  it("requires the shown head revisions before merging", () => {
    const open = stack.layers.filter((layer) => layer.number === 1);
    const heads = expectedHeadsFromLayers(open);
    expect(heads).toEqual([{ number: 1, headSha: "a".repeat(40) }]);
    expect(headsMatch(heads!, open)).toBe(true);
    expect(headsMatch([{ number: 1, headSha: "d".repeat(40) }], open)).toBe(false);
  });

  it("builds a merge-async request from a validated revision", () => {
    const repo = { host: "github.com", owner: "acme", repo: "web" };
    const sha = "a".repeat(40);
    expect(mergeStackArgs(repo, 7, "squash", sha)).toEqual([
      "api", "--hostname", "github.com", "--method", "PUT",
      "repos/acme/web/pulls/7/merge-async",
      "-f", "merge_method=squash", "-f", "merge_action=default", "-f", `sha=${sha}`,
    ]);
    expect(mergeStackPollArgs(repo, 7, "merge-uuid")).toEqual([
      "api", "--hostname", "github.com", "repos/acme/web/pulls/7/merge-async/merge-uuid",
    ]);
    expect(githubRepoFromRemote("origin https://github.com/acme/web.git (fetch)\n")).toEqual({
      host: "github.com", owner: "acme", repo: "web",
    });
    expect(sameGithubRepo(
      { host: "github.com", owner: "acme", repo: "web" },
      { host: "github.com", owner: "Acme", repo: "web" },
    )).toBe(true);
    expect(() => mergeStackArgs(repo, 7, "squash", "HEAD")).toThrow("stacked pull request");
    expect(() => mergeStackPollArgs(repo, 7, "../x")).toThrow("tracked");
  });

  it("keeps a listing when stack membership cannot be read", async () => {
    const items = [{
      number: 7,
      url: "https://github.com/acme/web/pull/7",
      title: "One",
      isDraft: false,
      state: "OPEN",
    }];
    const run: ReadCommand = async () => ({ ok: false, stdout: "", stderr: "HTTP 502" });
    expect(await enrichPullRequestsWithStacks("/repo", items, run)).toEqual(items);
  });

  it("targets the selected upstream explicitly even when the first remote is a fork", async () => {
    const payload = {
      number: 3,
      base: { ref: "main" },
      pull_requests: [
        { number: 7, title: "First", draft: false, head: { ref: "feat/one", sha: "a".repeat(40) }, state: "open" },
        { number: 8, title: "Second", draft: false, head: { ref: "feat/two", sha: "b".repeat(40) }, state: "open" },
      ],
    };
    const run: ReadCommand = async (command, args) => {
      if (command === "git" && args[0] === "remote") {
        return { ok: true, stdout: "origin https://github.com/fixture-fork/web.git (fetch)\nupstream https://github.com/acme/web.git (fetch)\n", stderr: "" };
      }
      if (args.includes("graphql")) return { ok: false, stdout: "", stderr: "unused" };
      if (args.some((arg) => String(arg).includes("stacks"))) {
        return { ok: true, stdout: JSON.stringify(payload), stderr: "" };
      }
      if (args.includes("PUT")) {
        expect(args.some((arg) => arg.startsWith("repos/acme/web/pulls/"))).toBe(true);
        expect(args.join(" ")).not.toContain("{owner}");
        return { ok: true, stdout: JSON.stringify({ status: "merged", details: {} }), stderr: "" };
      }
      return { ok: false, stdout: "", stderr: `unexpected ${args.join(" ")}` };
    };
    const result = await mergePullRequestStack("/repo", "squash", {
      number: 8,
      url: "https://github.com/acme/web/pull/8",
      stackNumber: 3,
      heads: [
        { number: 7, headSha: "a".repeat(40) },
        { number: 8, headSha: "b".repeat(40) },
      ],
    }, run);
    expect(result).toEqual({ ok: true, detail: "The stack was merged." });
    const otherRepo = await mergePullRequestStack("/repo", "squash", {
      number: 8,
      url: "https://github.com/other/repo/pull/8",
      stackNumber: 3,
      heads: [
        { number: 7, headSha: "a".repeat(40) },
        { number: 8, headSha: "b".repeat(40) },
      ],
    }, run);
    expect(otherRepo.ok).toBe(false);
    expect(otherRepo.detail).toMatch(/remote/i);
    const unknown = await mergePullRequestStack("/repo", "squash", {
      number: 8,
      url: "https://github.com/acme/web/pull/8",
      stackNumber: 3,
      heads: [
        { number: 7, headSha: "a".repeat(40) },
        { number: 8, headSha: "b".repeat(40) },
      ],
    }, async (command, args) => {
      if (command === "git" && args[0] === "remote") {
        return { ok: true, stdout: "origin https://github.com/acme/web.git (fetch)\n", stderr: "" };
      }
      if (args.some((arg) => String(arg).includes("stacks"))) {
        return { ok: true, stdout: JSON.stringify(payload), stderr: "" };
      }
      if (args.includes("PUT")) {
        return { ok: true, stdout: JSON.stringify({ status: "mystery", details: {} }), stderr: "" };
      }
      return { ok: false, stdout: "", stderr: "unused" };
    });
    expect(unknown).toEqual({ ok: false, detail: "GitHub reported an unexpected merge status (mystery)." });
    const stale = await mergePullRequestStack("/repo", "squash", {
      number: 8,
      url: "https://github.com/acme/web/pull/8",
      stackNumber: 3,
      heads: [
        { number: 7, headSha: "c".repeat(40) },
        { number: 8, headSha: "b".repeat(40) },
      ],
    }, run);
    expect(stale.ok).toBe(false);
    expect(stale.detail).toMatch(/changed/i);
  });
});
