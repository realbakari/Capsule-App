import type { GitPullRequest } from "@capsule/shared";

/**
 * A request to open a pull request in a project's Review panel, kept until the
 * panel for that project takes it. The sidebar raises it before the project
 * has finished switching, so the panel takes it once it is showing that project.
 */
export interface ReviewCommand { projectId: string; pullRequest: GitPullRequest }

export const REVIEW_COMMAND_EVENT = "capsule:review-command";
let pending: ReviewCommand | undefined;

export function requestReviewPullRequest(command: ReviewCommand): void {
  pending = command;
  window.dispatchEvent(new CustomEvent(REVIEW_COMMAND_EVENT));
}

/** Takes the pending request only when it is for this project. */
export function takeReviewCommand(projectId: string | undefined): ReviewCommand | undefined {
  if (!pending || pending.projectId !== projectId) return undefined;
  const command = pending;
  pending = undefined;
  return command;
}
