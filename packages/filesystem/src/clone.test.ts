import { describe, expect, it } from "vitest";
import { cloneRepositoryArgs, repositoryNameFromUrl } from "./clone.js";

describe("repository clone helpers", () => {
  it("derives names from HTTPS and SSH remotes", () => {
    expect(repositoryNameFromUrl("https://github.com/openai/codex.git")).toBe("codex");
    expect(repositoryNameFromUrl("git@github.com:openai/codex.git")).toBe("codex");
  });

  it("places the option terminator before an untrusted URL", () => {
    expect(cloneRepositoryArgs("https://example.com/repo.git", "/tmp/repo")).toEqual([
      "clone",
      "--",
      "https://example.com/repo.git",
      "/tmp/repo",
    ]);
  });
});

