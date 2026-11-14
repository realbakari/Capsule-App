import { FENCE_LABELS, fenceUntrusted } from "./untrusted.js";

/** An open issue of a project's GitHub repository, as the issue picker lists it. */
export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  author?: string;
  updatedAt?: string;
}

const BRANCH_WORDS = 6;
const BRANCH_SLUG_LENGTH = 40;

/** `issue-123-short-title`: the number, then the first words of the title. */
export function issueBranchName(issue: Pick<GithubIssue, "number" | "title">): string {
  const slug = issue.title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, BRANCH_WORDS)
    .join("-")
    .slice(0, BRANCH_SLUG_LENGTH)
    .replace(/-+$/, "");
  return slug ? `issue-${issue.number}-${slug}` : `issue-${issue.number}`;
}

const BODY_LIMIT = 6_000;

/**
 * The first prompt of a thread started from an issue: what to do, then the
 * issue itself. The title and body are someone else's words, fenced as
 * untrusted so the agent reads them as the task's description, not as
 * instructions from the user.
 */
export function issuePrompt(issue: GithubIssue): string {
  const body = issue.body.trim();
  const clipped = body.length > BODY_LIMIT ? `${body.slice(0, BODY_LIMIT)}\n\n[The issue continues at the link.]` : body;
  const text = [`#${issue.number} ${issue.title}`, clipped || "(The issue has no description.)"].join("\n\n");
  return [
    `Work on GitHub issue #${issue.number}: ${issue.url}`,
    "",
    fenceUntrusted(FENCE_LABELS.githubIssue, text),
  ].join("\n");
}
