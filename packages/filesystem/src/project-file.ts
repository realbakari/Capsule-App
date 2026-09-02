import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseProjectFile, PROJECT_FILE_NAME, type ProjectFileState } from "@capsule/shared";

/**
 * Reads `capsule.json` from a project folder.
 *
 * Best effort by design: a project without one is the normal case, and a
 * project with a broken one still has to open — the state says which, so the
 * project screen can show it rather than the app deciding on its own.
 */
export function readProjectFile(workingDirectory: string | undefined): ProjectFileState {
  if (!workingDirectory) return { status: "missing" };
  const file = path.join(workingDirectory, PROJECT_FILE_NAME);
  if (!existsSync(file)) return { status: "missing" };
  try {
    // A configuration file that needs a megabyte is not one.
    return parseProjectFile(readFileSync(file, "utf8").slice(0, 256 * 1024));
  } catch (error) {
    return {
      status: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
