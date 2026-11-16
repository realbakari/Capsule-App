import { sanitizeUntrusted, type GitPullRequestActivity, type GitPullRequestCheck } from "@capsule/shared";

/*
 * Prompts that hand a pull request's state back to the agent working on it.
 * Everything quoted comes from GitHub, so it is sanitised and bounded: a
 * comment can contain anything, including text shaped like instructions.
 */

const MAX_ITEMS = 8;
const MAX_BODY = 600;

const line = (value: string, maxChars = 200) => sanitizeUntrusted(value, { singleLine: true, maxChars });
const quote = (value: string) => sanitizeUntrusted(value.trim(), { maxChars: MAX_BODY }).split("\n").map((text) => `> ${text}`).join("\n");

/** Names every failing check, with its link, or undefined when nothing fails. */
export function fixChecksPrompt(number: number, checks: readonly GitPullRequestCheck[]): string | undefined {
  const failing = checks.filter((check) => check.state === "failure");
  if (failing.length === 0) return undefined;
  const rows = failing.slice(0, MAX_ITEMS).map((check) => {
    const name = line(check.workflow ? `${check.workflow} / ${check.name}` : check.name);
    return check.url ? `- ${name}: ${line(check.url, 500)}` : `- ${name}`;
  });
  const more = failing.length > MAX_ITEMS ? `\n- and ${failing.length - MAX_ITEMS} more` : "";
  return `These checks are failing on PR #${number}:\n\n${rows.join("\n")}${more}\n\n`
    + "Find out why each one fails (run it locally if you can), fix the cause, and tell me what you changed. Don't skip or disable a check to make it pass.";
}

/**
 * Quotes the review feedback worth acting on, newest last, or undefined when
 * there is none: reviews that asked for changes or commented, and comments,
 * leaving out the pull request author's own.
 */
export function addressReviewPrompt(number: number, activity: readonly GitPullRequestActivity[], author?: string): string | undefined {
  const feedback = activity.filter((item) => item.body.trim()
    && item.author !== author
    && (item.kind === "comment" || ["CHANGES_REQUESTED", "COMMENTED"].includes(item.state?.toUpperCase() ?? "")));
  if (feedback.length === 0) return undefined;
  const shown = feedback.slice(-MAX_ITEMS).map((item) => {
    const who = item.author ? line(item.author, 60) : "A reviewer";
    const what = item.kind === "review" && item.state?.toUpperCase() === "CHANGES_REQUESTED" ? "requested changes" : "commented";
    return `${who} ${what}:\n${quote(item.body)}`;
  });
  const earlier = feedback.length > MAX_ITEMS ? `(${feedback.length - MAX_ITEMS} earlier comments are not shown.)\n\n` : "";
  return `Review feedback on PR #${number}:\n\n${earlier}${shown.join("\n\n")}\n\n`
    + "Address each point in the code. Where you disagree or a point is already handled, say so instead of changing it, and list what you did for each.";
}
