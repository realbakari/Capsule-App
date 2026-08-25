import { describe, expect, it } from "vitest";
import { buildContract } from "./index.js";

describe("buildContract", () => {
  it("forbids auto-commit in code mode", () => {
    const contract = buildContract({ mode: "code", prompt: "Add a REST route" });
    expect(contract.forbidden.some((item) => item.value === "git-commit")).toBe(true);
    expect(contract.humanSummary).toContain("Never automatically commit");
  });

  it("requires sources in research mode", () => {
    const contract = buildContract({ mode: "research", prompt: "Summarize the protocol" });
    expect(contract.required.some((item) => item.value === "source")).toBe(true);
  });
});
