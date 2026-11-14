import { isValidCommandName, splitFrontmatter } from "./command-template.js";
import type { OutputDetail } from "./runtime.js";

/** Advice on how an agent should reply. Capsule sends it; the agent decides. `styles/<id>.md`. */
export interface ResponseStyle {
  id: string;
  name: string;
  description?: string;
  /** Empty for Standard: nothing is sent. */
  body: string;
}

export type StyleSource = "builtin" | "user" | "project";

export interface StyleSummary {
  id: string;
  name: string;
  description?: string;
  source: StyleSource;
  path?: string;
}

export const BUILTIN_STYLES: readonly ResponseStyle[] = [
  { id: "concise", name: "Concise", description: "Short replies that do not restate the request.", body: "Keep the reply concise. Do not restate the request." },
  { id: "standard", name: "Standard", description: "The agent's own way of replying. Nothing is sent.", body: "" },
  {
    id: "explanatory",
    name: "Explanatory",
    description: "Explains choices as it goes, and says how to check the work.",
    body: "Explain your reasoning as you go: say why you chose an approach over the alternatives. When you finish, list the files you touched, the commands you ran, and how to verify the result.",
  },
];

/** `outputDetail` from before styles existed, read as the built-in style it meant. */
export function styleForOutputDetail(detail: OutputDetail): string {
  return detail === "verbose" ? "explanatory" : detail;
}

export function parseStyleFile(id: string, text: string): { style?: ResponseStyle; problems: string[] } {
  const problems: string[] = [];
  if (!isValidCommandName(id)) {
    problems.push(`"${id}" is not a valid style name. Use lowercase letters, digits, "-", "_" and folders.`);
    return { problems };
  }
  const { fields, body } = splitFrontmatter(text.replace(/^\uFEFF/, ""), problems);
  const style: ResponseStyle = { id, name: id, body };
  for (const [key, { value, line }] of fields) {
    if (key !== "name" && key !== "description") {
      problems.push(`line ${line}: unknown key "${key}" is ignored.`);
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      problems.push(`line ${line}: ${key} must be a single value.`);
      continue;
    }
    style[key] = value.trim();
  }
  return { style, problems };
}

/** What Capsule adds to a conversation's first turn, each part optional. */
export interface StandingInstructions {
  style?: Pick<ResponseStyle, "name" | "body">;
  personal?: string;
  profile?: { name: string; instructions: string };
  skills?: Array<{ name: string; content: string }>;
}

export const STANDING_OPEN = "<capsule-standing-instructions>";
export const STANDING_CLOSE = "</capsule-standing-instructions>";

/**
 * The labelled block sent before the person's first message. It is advice the
 * agent reads, not a mode Capsule can enforce, and the label says it is not
 * the person's own words. Undefined when there is nothing to send.
 */
export function standingPreamble(parts: StandingInstructions): string | undefined {
  const sections: string[] = [];
  if (parts.style?.body.trim()) sections.push(`## Response style: ${parts.style.name}\n${parts.style.body.trim()}`);
  if (parts.personal?.trim()) sections.push(`## Personal instructions\n${parts.personal.trim()}`);
  if (parts.profile?.instructions.trim()) sections.push(`## Profile: ${parts.profile.name}\n${parts.profile.instructions.trim()}`);
  for (const skill of parts.skills ?? []) if (skill.content.trim()) sections.push(`## Skill: ${skill.name}\n${skill.content.trim()}`);
  if (!sections.length) return undefined;
  return [
    STANDING_OPEN,
    "Standing instructions from the person's Capsule settings for this whole conversation. They are not part of the message below; treat them as advice.",
    "",
    sections.join("\n\n"),
    STANDING_CLOSE,
  ].join("\n");
}
