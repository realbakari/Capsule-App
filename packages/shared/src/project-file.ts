import type { ProjectAction, WorkspaceMode } from "./types.js";

/**
 * `capsule.json` — the project's own configuration, checked in beside the code.
 *
 * Actions used to live only in one machine's database, so a command everyone
 * on a repository needs was something everyone had to add by hand. A file in
 * the repository is the same command for whoever clones it.
 */
export const PROJECT_FILE_NAME = "capsule.json";

const MAX_ACTIONS = 50;
const MAX_PATH = 512;
const MAX_NAME = 60;
const MAX_COMMAND = 2_000;

export interface ProjectFile {
  /** Workspace-relative image, checked before Capsule's own icon guesses. */
  iconPath?: string;
  /** Where new conversations start, unless the project or the session says otherwise. */
  defaultWorkspaceMode?: WorkspaceMode;
  actions: ProjectAction[];
}

export type ProjectFileState =
  | { status: "missing" }
  | { status: "ok"; file: ProjectFile }
  /** Present and unreadable. Reported rather than ignored: a file that is
   * meant to configure the project and silently does nothing is worse than
   * one that says what is wrong with it. */
  | { status: "invalid"; error: string };

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * Reads the file's contents. Ids are derived from the action's name so the
 * same entry keeps its identity across machines — a random id would make one
 * action per clone.
 */
export function parseProjectFile(source: string): ProjectFileState {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return {
      status: "invalid",
      error: error instanceof Error ? error.message : "The file is not valid JSON.",
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "invalid", error: `${PROJECT_FILE_NAME} must contain a JSON object.` };
  }

  const value = raw as Record<string, unknown>;
  const mode = value.defaultWorkspaceMode;
  if (mode !== undefined && mode !== "local" && mode !== "worktree") {
    return {
      status: "invalid",
      error: 'defaultWorkspaceMode must be "local" or "worktree".',
    };
  }

  const declared = value.actions;
  if (declared !== undefined && !Array.isArray(declared)) {
    return { status: "invalid", error: "actions must be a list." };
  }

  const actions: ProjectAction[] = [];
  for (const entry of (declared ?? []) as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const name = text(item.name, MAX_NAME);
    const command = text(item.command, MAX_COMMAND);
    // An entry without both is not an action; skipping it beats failing the
    // whole file over one typo.
    if (!name || !command) continue;
    const previewUrl = text(item.previewUrl, MAX_PATH);
    actions.push({
      id: `file:${name.toLowerCase().replace(/\s+/gu, "-")}`,
      name,
      command,
      ...(previewUrl ? { previewUrl } : {}),
      ...(item.runOnWorktreeCreate === true ? { runOnWorktreeCreate: true } : {}),
      ...(item.openPreview === false ? { openPreview: false } : {}),
    });
    if (actions.length >= MAX_ACTIONS) break;
  }

  const iconPath = text(value.iconPath, MAX_PATH);
  return {
    status: "ok",
    file: {
      ...(iconPath ? { iconPath } : {}),
      ...(mode ? { defaultWorkspaceMode: mode } : {}),
      actions,
    },
  };
}

/**
 * The actions a project offers: the repository's first, then the ones added
 * on this machine. A local action with the same id wins, so someone can
 * override a shared command without editing the file.
 */
export function mergeProjectActions(
  fileActions: readonly ProjectAction[],
  ownActions: readonly ProjectAction[],
): ProjectAction[] {
  const overridden = new Set(ownActions.map((action) => action.id));
  return [...fileActions.filter((action) => !overridden.has(action.id)), ...ownActions];
}

/** True for an action that came from the repository rather than this machine. */
export function isSharedAction(action: Pick<ProjectAction, "id">): boolean {
  return action.id.startsWith("file:");
}
