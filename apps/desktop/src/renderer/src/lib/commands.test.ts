import { describe, expect, it } from "vitest";
import type { CommandSummary } from "@capsule/shared";
import { commandDetail, commandInDraft } from "./commands";

const review: CommandSummary = { name: "git:review", argumentHint: "<number>", description: "Review a pull request", source: "user", scope: "user", path: "/u/review.md", send: "review", shell: "none" };

describe("commandInDraft", () => {
  it("finds the command a draft starts with, and only a whole name", () => {
    expect(commandInDraft("/git:review 12", [review])).toBe(review);
    expect(commandInDraft("  /git:review", [review])).toBe(review);
    expect(commandInDraft("/git:reviewer 12", [review])).toBeUndefined();
    expect(commandInDraft("please /git:review", [review])).toBeUndefined();
    expect(commandInDraft("/git:review", undefined)).toBeUndefined();
  });

  it("describes a command by its arguments, then what it does", () => {
    expect(commandDetail(review)).toBe("<number> · Review a pull request");
    expect(commandDetail({ ...review, argumentHint: undefined, description: undefined })).toBeUndefined();
  });
});
