import { isValidCommandName, splitFrontmatter } from "./command-template.js";
import type { HarnessPermissionProfile } from "./harness.js";
import { AGENT_MODES } from "./runtime.js";
import type { AgentMode, WorkspaceMode } from "./types.js";

/**
 * An agent profile: one pick that starts a conversation with an agent, a
 * model, an effort, a policy and standing instructions. `profiles/<id>.md`.
 */
export interface AgentProfile {
  /** `reviewer`, or `team:reviewer` for `team/reviewer.md`, like a command's name. */
  id: string;
  name: string;
  description?: string;
  /** An agent id or a harness id (`codex`, `claude`). Frontmatter `harness`. */
  agent?: string;
  model?: string;
  /** The agent's own effort value, such as `high`. Applied where the route reports an effort control. */
  effort?: string;
  permission?: HarnessPermissionProfile;
  mode?: AgentMode;
  workspace?: WorkspaceMode;
  /** Installed skill ids whose instructions join the first turn. */
  skills: string[];
  /** A response style id, which replaces the `style` setting for this conversation. */
  style?: string;
  /** MCP server names this profile offers. Absent offers every enabled server. */
  mcp?: string[];
  /** `#RRGGBB`, for the picker. */
  color?: string;
  /** The file's body: standing instructions sent with the first turn. */
  instructions: string;
}

/** What the renderer gets: a profile without its body, and the file it came from. */
export interface ProfileSummary extends Omit<AgentProfile, "instructions"> {
  scope: "user" | "project";
  path: string;
  hasInstructions: boolean;
}

export interface ParsedProfileFile {
  profile?: AgentProfile;
  problems: string[];
}

const PERMISSIONS: readonly HarnessPermissionProfile[] = ["default", "strict", "approve-all"];
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const WORD = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function parseProfileFile(id: string, text: string): ParsedProfileFile {
  const problems: string[] = [];
  if (!isValidCommandName(id)) {
    problems.push(`"${id}" is not a valid profile name. Use lowercase letters, digits, "-", "_" and folders.`);
    return { problems };
  }
  const { fields, body } = splitFrontmatter(text.replace(/^\uFEFF/, ""), problems);
  const profile: AgentProfile = { id, name: id, skills: [], instructions: body };
  for (const [key, { value, line }] of fields) {
    const where = `line ${line}: ${key}`;
    const single = (): string | undefined => {
      if (typeof value === "string" && value.trim()) return value.trim();
      problems.push(`${where} must be a single value.`);
      return undefined;
    };
    const list = (): string[] => (typeof value === "string" ? value.split(/[\s,]+/) : value).map((item) => item.trim()).filter(Boolean);
    const oneOf = <T extends string>(choices: readonly T[]): T | undefined => {
      const v = single();
      const found = choices.find((choice) => choice === v);
      if (v !== undefined && !found) problems.push(`${where} must be one of ${choices.join(", ")}.`);
      return found;
    };
    switch (key) {
      case "name": profile.name = single() ?? profile.name; break;
      case "description": profile.description = single(); break;
      case "harness": case "agent": profile.agent = single(); break;
      case "model": profile.model = single(); break;
      case "effort": {
        const v = single();
        if (v && WORD.test(v)) profile.effort = v;
        else if (v) problems.push(`${where} must be one word, such as high.`);
        break;
      }
      case "permission": profile.permission = oneOf(PERMISSIONS); break;
      case "mode": profile.mode = oneOf(AGENT_MODES); break;
      case "workspace": profile.workspace = oneOf(["local", "worktree"] as const); break;
      case "skills": profile.skills = list(); break;
      case "style": profile.style = single(); break;
      case "mcp": profile.mcp = list(); break;
      case "color": {
        const v = single();
        if (v && COLOR.test(v)) profile.color = v;
        else if (v) problems.push(`${where} must be a colour like #4A7A5C.`);
        break;
      }
      default:
        problems.push(`line ${line}: unknown key "${key}" is ignored.`);
    }
  }
  const defined = Object.entries(profile).filter(([, v]) => v !== undefined);
  return { profile: Object.fromEntries(defined) as unknown as AgentProfile, problems };
}

export function summarizeProfile(profile: AgentProfile, file: { scope: "user" | "project"; path: string }): ProfileSummary {
  const { instructions, ...rest } = profile;
  return { ...rest, scope: file.scope, path: file.path, hasInstructions: instructions.trim().length > 0 };
}

/** The text a new profile file starts with. */
export function profileTemplate(name: string): string {
  return [
    "---",
    `name: ${name}`,
    "description: What this profile is for",
    "# harness: codex",
    "# model: gpt-5.5",
    "# effort: high",
    "# permission: strict",
    "# mode: code",
    "# workspace: worktree",
    "# style: concise",
    "# mcp: [postgres]",
    "# color: \"#4A7A5C\"",
    "---",
    "",
    "Standing instructions for the first turn go here. Leave this empty for none.",
    "",
  ].join("\n");
}
