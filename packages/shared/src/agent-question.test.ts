import { describe, expect, it } from "vitest";
import { readRequestQuestions, readToolQuestions, requestAnswerPayload, toolAnswerPayload, validateQuestionAnswers } from "./agent-question.js";

const tool = readToolQuestions({ questions: [
  { question: "Which library?", header: "Library", multiSelect: false, options: [{ label: "date-fns", description: "Small" }, { label: "luxon", description: "Zones" }] },
  { question: "Which checks?", header: "Checks", multiSelect: true, options: [{ label: "Lint" }, { label: "Types" }] },
] });

describe("agent questions", () => {
  it("reads the tool form and answers by question text, joining several choices", () => {
    expect(tool.map((question) => [question.id, question.multiSelect, question.allowOther])).toEqual([["q0", false, true], ["q1", true, true]]);
    const answers = validateQuestionAnswers(tool, { q0: ["luxon"], q1: ["Lint", "Types"] });
    expect(toolAnswerPayload(tool, answers)).toEqual({ "Which library?": "luxon", "Which checks?": "Lint, Types" });
  });

  it("reads the request form, keeps ids, and treats a question with no options as free text", () => {
    const request = readRequestQuestions({ questions: [
      { id: "db", header: "DB", question: "Which?", options: [{ label: "SQLite", description: "" }], isOther: false },
      { id: "name", header: "Name", question: "Project name?", options: null },
      { id: "", question: "dropped" },
    ] });
    expect(request.map((question) => [question.id, question.allowOther])).toEqual([["db", false], ["name", true]]);
    expect(requestAnswerPayload({ db: ["SQLite"] })).toEqual({ db: { answers: ["SQLite"] } });
  });

  it("refuses missing answers, two answers to one choice, and choices that were not offered", () => {
    const strict = readRequestQuestions({ questions: [{ id: "db", header: "DB", question: "Which?", options: [{ label: "SQLite", description: "" }] }] });
    expect(() => validateQuestionAnswers(tool, { q0: ["luxon"] })).toThrow(/Checks/);
    expect(() => validateQuestionAnswers(tool, { q0: ["luxon", "date-fns"], q1: ["Lint"] })).toThrow(/one answer/);
    expect(() => validateQuestionAnswers(strict, { db: ["MySQL"] })).toThrow(/offered/);
    expect(validateQuestionAnswers(tool, { q0: ["  my own  "], q1: ["Lint"] }).q0).toEqual(["my own"]);
  });

  it("strips control and bidi characters from agent text", () => {
    const [question] = readToolQuestions({ questions: [{ question: "Pick‮ one?", options: [] }] });
    expect(question!.question).toBe("Pick one?");
  });
});
