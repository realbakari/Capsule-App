/**
 * Saved prompts with typed blanks.
 *
 * `{{name}}` asks for free text; `{{name:a|b|c}}` asks for one of a fixed set.
 * A project keeps its own in capsule.json and everyone who clones it gets the
 * same ones; personal ones live in settings. Both show in the composer's `/`
 * menu, and picking one asks for its blanks before it fills the draft.
 */
export interface PromptTemplate {
  name: string;
  prompt: string;
  description?: string;
}

export interface TemplateVariable {
  name: string;
  /** Present for a choice; absent for free text. */
  choices?: string[];
}

const MAX_TEMPLATES = 50;
const MAX_NAME = 60;
const MAX_PROMPT = 8_000;
const MAX_DESCRIPTION = 200;
const PLACEHOLDER = /\{\{\s*([A-Za-z][\w-]{0,39})\s*(?::([^{}]*))?\}\}/gu;

/** Each blank once, in the order it first appears. The first spelling of a choice list wins. */
export function templateVariables(prompt: string): TemplateVariable[] {
  const seen = new Map<string, TemplateVariable>();
  for (const match of prompt.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (seen.has(name)) continue;
    const choices = match[2]?.split("|").map((choice) => choice.trim()).filter(Boolean);
    seen.set(name, choices?.length ? { name, choices: [...new Set(choices)] } : { name });
  }
  return [...seen.values()];
}

/** Fill every blank. A choice blank only takes one of its choices; a missing value is an error, not an empty string. */
export function fillTemplate(prompt: string, values: Readonly<Record<string, string>>): string {
  const variables = new Map(templateVariables(prompt).map((variable) => [variable.name, variable]));
  for (const variable of variables.values()) {
    const value = values[variable.name]?.trim();
    if (!value) throw new Error(`Fill in ${variable.name}.`);
    if (variable.choices && !variable.choices.includes(value)) throw new Error(`${variable.name} must be one of ${variable.choices.join(", ")}.`);
  }
  return prompt.replace(PLACEHOLDER, (_whole, name: string) => values[name]!.trim());
}

/** The `/` command a template answers to. */
export function templateCommand(template: Pick<PromptTemplate, "name">): string {
  return `/${template.name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/gu, "") || "prompt"}`;
}

/** Keep well-formed entries and drop the rest: one typo should not hide every other prompt. */
export function normalizePromptTemplates(value: unknown): PromptTemplate[] {
  if (!Array.isArray(value)) return [];
  const templates: PromptTemplate[] = [];
  const names = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, MAX_NAME) : "";
    const prompt = typeof item.prompt === "string" ? item.prompt.trim().slice(0, MAX_PROMPT) : "";
    if (!name || !prompt || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    const description = typeof item.description === "string" ? item.description.trim().slice(0, MAX_DESCRIPTION) : "";
    templates.push({ name, prompt, ...(description ? { description } : {}) });
    if (templates.length >= MAX_TEMPLATES) break;
  }
  return templates;
}
