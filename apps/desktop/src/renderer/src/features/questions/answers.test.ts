import { describe, expect, it } from "vitest";
import type { AgentQuestion } from "@capsule/shared";
import { answersFromDrafts } from "./QuestionCard";

const single: AgentQuestion = { id: "db", question: "Which?", options: [{ label: "A" }, { label: "B" }], multiSelect: false, allowOther: true, secret: false };
const many: AgentQuestion = { ...single, id: "checks", multiSelect: true };

describe("question card answers", () => {
  it("lets a typed answer replace a single choice and join several choices", () => {
    expect(answersFromDrafts([single, many], { db: { picked: ["A"], other: " mine " }, checks: { picked: ["A", "B"], other: "C" } }))
      .toEqual({ db: ["mine"], checks: ["A", "B", "C"] });
    expect(answersFromDrafts([single], {})).toEqual({ db: [] });
  });
});
