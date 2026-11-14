import {
  BUILTIN_STYLES,
  commandNameFromPath,
  parseProfileFile,
  parseStyleFile,
  type AgentProfile,
  type ConfigProblem,
  type ResponseStyle,
  type StyleSource,
} from "@capsule/shared";
import type { ResourceFile } from "./resources.js";

export interface ProfileEntry {
  profile: AgentProfile;
  scope: "user" | "project";
  path: string;
}

export interface StyleEntry {
  style: ResponseStyle;
  source: StyleSource;
  path?: string;
}

/** The project's file wins over the user's of the same id; each shadowed file is a warning. */
function byPrecedence<T extends { path: string }>(files: readonly ResourceFile[], read: (file: ResourceFile, problems: ConfigProblem[]) => T | undefined, kind: string) {
  const winners = new Map<string, T>();
  const problems: ConfigProblem[] = [];
  for (const file of [...files].sort((a, b) => Number(b.scope === "project") - Number(a.scope === "project"))) {
    const id = commandNameFromPath(file.name);
    const entry = read(file, problems);
    if (!entry) continue;
    const winner = winners.get(id);
    if (winner) problems.push({ severity: "warning", path: file.path, message: `${winner.path} defines the ${kind} "${id}" too and wins, so this file is not used.` });
    else winners.set(id, entry);
  }
  return { winners, problems };
}

export function readProfileCatalog(files: readonly ResourceFile[]): { profiles: ProfileEntry[]; problems: ConfigProblem[] } {
  const { winners, problems } = byPrecedence(files, (file, out) => {
    const parsed = parseProfileFile(commandNameFromPath(file.name), file.text);
    for (const message of parsed.problems) out.push({ severity: parsed.profile ? "warning" : "error", path: file.path, message });
    return parsed.profile ? { profile: parsed.profile, scope: file.scope, path: file.path } : undefined;
  }, "profile");
  return { profiles: [...winners.values()].sort((a, b) => a.profile.name.localeCompare(b.profile.name)), problems };
}

/** Files first, so a file named after a built-in style replaces it. */
export function readStyleCatalog(files: readonly ResourceFile[]): { styles: StyleEntry[]; problems: ConfigProblem[] } {
  const { winners, problems } = byPrecedence(files, (file, out) => {
    const parsed = parseStyleFile(commandNameFromPath(file.name), file.text);
    for (const message of parsed.problems) out.push({ severity: parsed.style ? "warning" : "error", path: file.path, message });
    return parsed.style ? { style: parsed.style, source: file.scope, path: file.path } : undefined;
  }, "style");
  const styles: StyleEntry[] = [...winners.values()];
  for (const style of BUILTIN_STYLES) if (!winners.has(style.id)) styles.push({ style, source: "builtin" });
  return { styles, problems };
}
