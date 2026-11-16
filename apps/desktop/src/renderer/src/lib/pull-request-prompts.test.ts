import { describe, expect, it } from "vitest";
import { addressReviewPrompt, fixChecksPrompt } from "./pull-request-prompts";

describe("pull request prompts", () => {
  it("names only failing checks, with their links", () => {
    const prompt = fixChecksPrompt(12, [
      { name: "unit", workflow: "CI", state: "failure", url: "https://example.test/run/1" },
      { name: "lint", state: "success" },
    ]);
    expect(prompt).toContain("- CI / unit: https://example.test/run/1");
    expect(prompt).not.toContain("lint");
    expect(fixChecksPrompt(12, [{ name: "lint", state: "success" }])).toBeUndefined();
  });

  it("quotes reviewer feedback, not the author's own or approvals", () => {
    const prompt = addressReviewPrompt(7, [
      { id: "1", kind: "review", author: "rev", state: "CHANGES_REQUESTED", body: "Rename this.\nAnd add a test." },
      { id: "2", kind: "review", author: "rev", state: "APPROVED", body: "Looks good" },
      { id: "3", kind: "comment", author: "me", body: "Thanks!" },
    ], "me");
    expect(prompt).toContain("rev requested changes:\n> Rename this.\n> And add a test.");
    expect(prompt).not.toContain("Looks good");
    expect(prompt).not.toContain("Thanks!");
    expect(addressReviewPrompt(7, [{ id: "3", kind: "comment", author: "me", body: "Thanks!" }], "me")).toBeUndefined();
  });
});
