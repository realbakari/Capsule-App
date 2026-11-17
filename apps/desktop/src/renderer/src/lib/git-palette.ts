import type { GitStatus } from "@capsule/shared";
import { plural, pushBlocked, syncState } from "./git-plan";

/** What a git palette row does; the palette maps each to its handler. */
export type GitPaletteAction = "commit-menu" | "push" | "pull" | "rebase" | "pull-request" | "branch-menu";

export interface GitPaletteRow {
  id: string;
  label: string;
  detail?: string;
  keywords: string;
  action: GitPaletteAction;
  disabledReason?: string;
}

/** Fired by the palette; the titlebar opens Conversation details with that menu showing. */
export const OPEN_GIT_MENU_EVENT = "capsule:open-git-menu";
export type GitMenu = "commit" | "branch";

/**
 * The palette's git rows for the open project, each disabled with the reason
 * it cannot run. Every one is a write, so a paired device sees them disabled.
 */
export function gitPaletteRows(git: GitStatus | undefined, context: { hasProject: boolean; desktop: boolean; }): GitPaletteRow[] {
  const sync = git?.isRepo ? syncState(git) : undefined;
  const blocked = !context.desktop ? "Available in the desktop app."
    : !context.hasProject ? "Open a project first."
      : !git ? "Reading Git status…"
        : !git.isRepo ? "This folder is not a Git repository." : undefined;
  const pull = sync?.kind === "diverged"
    ? { action: "rebase" as const, label: `Rebase onto ${sync.upstream}`, detail: `${sync.ahead} ahead, ${sync.behind} behind`, reason: undefined }
    : { action: "pull" as const, label: sync?.kind === "behind" ? `Pull ${plural(sync.behind, "commit")}` : "Pull",
      detail: undefined,
      reason: sync?.kind === "behind" ? undefined
        : sync?.kind === "publish" || sync?.kind === "no-remote" ? "This branch is not published, so there is nothing to pull."
          : sync?.kind === "detached" ? "Check out a branch before pulling."
            : sync ? `Nothing to pull: this branch has every commit on ${"upstream" in sync ? sync.upstream : "its upstream"}.` : undefined };
  return [
    { id: "git-commit", label: "Commit…", detail: git?.dirty ? plural(git.changed, "changed file") : undefined, keywords: "git commit stage changes", action: "commit-menu",
      disabledReason: blocked ?? (git?.dirty ? undefined : "Nothing to commit. The working tree is clean.") },
    { id: "git-push", label: sync?.kind === "publish" ? "Publish branch" : sync?.kind === "ahead" ? `Push ${plural(sync.ahead, "commit")}` : "Push", keywords: "git push publish upload remote", action: "push",
      disabledReason: blocked ?? (sync ? pushBlocked(sync) : undefined) },
    { id: "git-pull", label: pull.label, detail: pull.detail, keywords: "git pull rebase fetch update remote", action: pull.action, disabledReason: blocked ?? pull.reason },
    { id: "git-pull-request", label: "Create pull request", keywords: "git pr github open", action: "pull-request",
      disabledReason: blocked ?? (git?.pullRequest ? `Pull request #${git.pullRequest.number} is already open.`
        : git?.ghAvailable === false ? "The GitHub CLI (gh) is not installed or not signed in." : undefined) },
    { id: "git-switch-branch", label: "Switch branch…", keywords: "git checkout branch remote", action: "branch-menu", disabledReason: blocked },
    { id: "git-create-branch", label: "Create branch…", keywords: "git new branch", action: "branch-menu", disabledReason: blocked },
  ];
}
