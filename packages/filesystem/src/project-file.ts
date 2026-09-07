import { existsSync } from "node:fs";
import { readBoundedFileSync } from "./bounded-read.js";
import { resolveProjectPath } from "./contained-path.js";

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
  try {
    const file = resolveProjectPath(workingDirectory, PROJECT_FILE_NAME);
    if (!existsSync(file)) return { status: "missing" };
    return parseProjectFile(readBoundedFileSync(file, 256 * 1024, workingDirectory).toString("utf8"));
  } catch (error) {
    return {
      status: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
