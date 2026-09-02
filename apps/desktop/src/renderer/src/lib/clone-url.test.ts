import { describe, expect, it } from "vitest";

import { cloneFolderName, normalizeCloneUrl } from "./clone-url";

describe("normalizeCloneUrl", () => {
  it("expands the way people name a GitHub repository", () => {
    expect(normalizeCloneUrl("pingdotgg/t3code")).toBe("https://github.com/pingdotgg/t3code.git");
    expect(normalizeCloneUrl("github.com/owner/repo")).toBe("https://github.com/owner/repo.git");
    expect(normalizeCloneUrl("owner/repo.git")).toBe("https://github.com/owner/repo.git");
  });

  it("leaves a real URL alone", () => {
    expect(normalizeCloneUrl("https://gitlab.com/group/project.git")).toBe(
      "https://gitlab.com/group/project.git",
    );
    expect(normalizeCloneUrl("git@github.com:owner/repo.git")).toBe("git@github.com:owner/repo.git");
  });

  it("refuses what is not a repository", () => {
    expect(normalizeCloneUrl("")).toBeUndefined();
    expect(normalizeCloneUrl("just some words")).toBeUndefined();
    expect(normalizeCloneUrl("owner")).toBeUndefined();
  });
});

describe("cloneFolderName", () => {
  it("names the folder a clone would create", () => {
    expect(cloneFolderName("https://github.com/owner/repo.git")).toBe("repo");
    expect(cloneFolderName("git@github.com:owner/repo.git")).toBe("repo");
    expect(cloneFolderName("https://example.com/group/project/")).toBe("project");
  });
});
