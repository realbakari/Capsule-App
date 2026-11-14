import { sanitizeUntrusted } from "./untrusted.js";

/**
 * A question an agent stops to ask, with the choices it offers.
 *
 * Agents ask through different tools: one sends its question as a tool the
 * host must approve, another as a dedicated request. Both arrive here as the
 * same shape, so the card that answers them is one component and the answer
 * goes back in whichever form the agent asked in.
 */
export interface AgentQuestionOption {
  label: string;
  description?: string;
}

export interface AgentQuestion {
  /** Stable within the request; answers are keyed by it. */
  id: string;
  /** A short tag for the question, when the agent gave one. */
  header?: string;
  question: string;
  options: AgentQuestionOption[];
  multiSelect: boolean;
  /** Free text is accepted alongside, or instead of, the options. */
  allowOther: boolean;
  /** The answer is a secret: masked while typed and never written to the transcript. */
  secret: boolean;
}

/** Question id to the chosen labels and any free text, in order. */
export type AgentQuestionAnswers = Record<string, string[]>;

const MAX_QUESTIONS = 8;
const MAX_OPTIONS = 12;

const text = (value: unknown, limit: number) => (typeof value === "string" ? sanitizeUntrusted(value).slice(0, limit).trim() : "");

function readOptions(value: unknown): AgentQuestionOption[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_OPTIONS).flatMap((item) => {
    const option = (item ?? {}) as Record<string, unknown>;
    const label = text(option.label, 200);
    if (!label) return [];
    const description = text(option.description, 600);
    return [description ? { label, description } : { label }];
  });
}

/** The question tool whose input carries `questions: [{ question, header, options, multiSelect }]`. */
export function readToolQuestions(input: unknown): AgentQuestion[] {
  const questions = (input as { questions?: unknown } | undefined)?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.slice(0, MAX_QUESTIONS).flatMap((item, index) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const question = text(raw.question, 1_000);
    if (!question) return [];
    const header = text(raw.header, 40);
    return [{
      id: `q${index}`,
      ...(header ? { header } : {}),
      question,
      options: readOptions(raw.options),
      multiSelect: raw.multiSelect === true,
      allowOther: true,
      secret: false,
    }];
  });
}

/** The dedicated request whose params carry `questions: [{ id, header, question, options, isOther, isSecret }]`. */
export function readRequestQuestions(params: unknown): AgentQuestion[] {
  const questions = (params as { questions?: unknown } | undefined)?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.slice(0, MAX_QUESTIONS).flatMap((item) => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.slice(0, 200) : "";
    const question = text(raw.question, 1_000);
    if (!id || !question) return [];
    const header = text(raw.header, 40);
    const options = readOptions(raw.options);
    return [{
      id,
      ...(header ? { header } : {}),
      question,
      options,
      multiSelect: false,
      // With no options the only way to answer is to type.
      allowOther: raw.isOther === true || options.length === 0,
      secret: raw.isSecret === true,
    }];
  });
}

/**
 * Checks answers against the questions they answer. Every question needs an
 * answer; a choice must be one that was offered unless free text is allowed;
 * a single-choice question takes one.
 */
export function validateQuestionAnswers(questions: readonly AgentQuestion[], answers: unknown): AgentQuestionAnswers {
  const input = (answers ?? {}) as Record<string, unknown>;
  const out: AgentQuestionAnswers = {};
  for (const question of questions) {
    const given = input[question.id];
    if (!Array.isArray(given)) throw new Error(`Answer “${question.header ?? question.question}”.`);
    const values = given.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).slice(0, MAX_OPTIONS + 1);
    if (values.length === 0) throw new Error(`Answer “${question.header ?? question.question}”.`);
    if (!question.multiSelect && values.length > 1) throw new Error(`“${question.header ?? question.question}” takes one answer.`);
    const offered = new Set(question.options.map((option) => option.label));
    if (!question.allowOther && values.some((value) => !offered.has(value))) throw new Error("Choose one of the offered answers.");
    out[question.id] = values.map((value) => value.slice(0, 4_000));
  }
  return out;
}

/** The tool form: question text to the answer, several choices joined by a comma. */
export function toolAnswerPayload(questions: readonly AgentQuestion[], answers: AgentQuestionAnswers): Record<string, string> {
  return Object.fromEntries(questions.map((question) => [question.question, (answers[question.id] ?? []).join(", ")]));
}

/** The request form: question id to `{ answers: [...] }`. */
export function requestAnswerPayload(answers: AgentQuestionAnswers): Record<string, { answers: string[] }> {
  return Object.fromEntries(Object.entries(answers).map(([id, values]) => [id, { answers: values }]));
}
