import path from "node:path";
import {
  commandNameFromPath,
  parseCommandFile,
  type CommandSource,
  type CommandSourceId,
  type CommandTemplate,
  type ConfigProblem,
} from "@capsule/shared";
import { PROJECT_CONFIG_DIR } from "./paths.js";
import { listResourceFolder } from "./resources.js";

/** A folder of command files and what its files are. */
export interface CommandFolder {
  source: CommandSource;
  scope: "user" | "project";
  dir: string;
  /** A plugin's folder fills in `${PLUGIN_ROOT}`, `${PLUGIN_DATA}` and its options before the file is parsed. */
  fill?: (text: string) => string;
}

/** A command that can be invoked, and the file it came from. */
export interface CommandEntry {
  command: CommandTemplate;
  source: CommandSource;
  scope: "user" | "project";
  path: string;
}

export interface CommandCatalog {
  /** One entry per name, the highest-precedence file's, sorted by name. */
  commands: CommandEntry[];
  problems: ConfigProblem[];
}

/** Other tools' folders are read as Markdown only; their own frontmatter keys are not mistakes. */
const FOREIGN: ReadonlySet<CommandSource> = new Set(["claude", "codex"]);

/**
 * Every folder commands come from, in precedence order: the project's, the
 * user's, then plugins', then other tools' folders the user turned on.
 * `pluginDirs` lists each enabled plugin's `commands/` folder.
 */
export function commandFolders(input: {
  userDir: string;
  homeDir: string;
  root?: string;
  sources: Partial<Record<CommandSourceId, boolean>>;
  pluginDirs?: ReadonlyArray<{ dir: string; fill?: (text: string) => string }>;
}): CommandFolder[] {
  const { userDir, homeDir, root, sources } = input;
  const folders: CommandFolder[] = [
    ...(root ? [{ source: "project" as const, scope: "project" as const, dir: path.join(root, PROJECT_CONFIG_DIR, "commands") }] : []),
    { source: "user", scope: "user", dir: path.join(userDir, "commands") },
    ...(input.pluginDirs ?? []).map(({ dir, fill }) => ({ source: "plugin" as const, scope: "user" as const, dir, ...(fill ? { fill } : {}) })),
  ];
  if (sources["claude-commands"]) {
    if (root) folders.push({ source: "claude", scope: "project", dir: path.join(root, ".claude", "commands") });
    folders.push({ source: "claude", scope: "user", dir: path.join(homeDir, ".claude", "commands") });
  }
  if (sources["codex-prompts"]) folders.push({ source: "codex", scope: "user", dir: path.join(homeDir, ".codex", "prompts") });
  const seen = new Set<string>();
  return folders.filter((folder) => {
    const key = path.resolve(folder.dir);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Read and parse every command file in the folders; a name's first file wins. */
export function readCommandCatalog(folders: readonly CommandFolder[]): CommandCatalog {
  const winners = new Map<string, CommandEntry>();
  const problems: ConfigProblem[] = [];
  for (const folder of folders) {
    const foreign = FOREIGN.has(folder.source);
    for (const file of listResourceFolder("commands", folder.scope, folder.dir)) {
      const name = commandNameFromPath(foreign ? file.name.toLowerCase() : file.name);
      const parsed = parseCommandFile(name, folder.fill ? folder.fill(file.text) : file.text, { ignoreUnknownKeys: foreign });
      for (const message of parsed.problems) problems.push({ severity: parsed.command ? "warning" : "error", path: file.path, message });
      if (!parsed.command) continue;
      const winner = winners.get(name);
      if (winner) {
        problems.push({ severity: "warning", path: file.path, message: `/${name} is also defined in ${winner.path}, which takes precedence, so this file is not used.` });
        continue;
      }
      winners.set(name, { command: parsed.command, source: folder.source, scope: folder.scope, path: file.path });
    }
  }
  const commands = [...winners.values()].sort((a, b) => a.command.name.localeCompare(b.command.name));
  return { commands, problems };
}
