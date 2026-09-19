import { describe, expect, it } from "vitest";
import type { GitPullRequestStack } from "@capsule/shared";
import { mergeLayersThrough, mergePrompt, rebasePrompt, stackActionFromDetail, stackSearchText } from "./pull-request-stack";

const stack: GitPullRequestStack = {
  number: 9,
  base: "main",
  layers: [
    { number: 1, title: "Base", headBranch: "a", headSha: "a".repeat(40), state: "open" },
    { number: 2, title: "Top", headBranch: "b", headSha: "b".repeat(40), state: "open" },
  ],
};

describe("pull request stack copy", () => {
  it("names the layers a merge will land", () => {
    expect(mergePrompt(stack, 1)).toContain("Merge pull request #1 into main");
    expect(mergePrompt(stack, 2)).toContain("#1");
    expect(rebasePrompt(stack)).toContain("local checkout is not changed");
  });

  it("hides merge when a closed layer sits below the selection", () => {
    expect(mergeLayersThrough({
      ...stack,
      layers: [
        { ...stack.layers[0]!, state: "closed" },
        stack.layers[1]!,
      ],
    }, 2)).toBeUndefined();
  });

  it("refuses a stack action without a head revision for every open layer", () => {
    expect(stackActionFromDetail("https://github.com/acme/web/pull/2", 2, stack, stack.layers)?.heads).toHaveLength(2);
    expect(stackActionFromDetail("https://github.com/acme/web/pull/2", 2, stack, [{ ...stack.layers[0]!, headSha: undefined }, stack.layers[1]!])).toBeUndefined();
    expect(stackSearchText({ number: 2, url: "https://github.com/acme/web/pull/2", title: "Top", isDraft: false, state: "OPEN", stack: { number: 9, size: 2, position: 2, base: "main" } })).toBe("2/2");
  });
});
