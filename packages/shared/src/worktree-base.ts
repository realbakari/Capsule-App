/**
 * A Git ref name that passed `parseGitRefName`. Anything that reaches `git`
 * as a base for a new worktree has been through it, so a renderer string can
 * never become an option (`--upload-pack=…`) or a revision expression.
 */
export type GitRefName = string & { readonly __gitRefName: true };

/*
 * `git check-ref-format` rules, applied to the short names people pick
 * (`main`, `origin/main`, `HEAD`), minus revision syntax: no `~`, `^`, `:`,
 * `@{`, and no leading `-`. Stricter than Git, never looser.
 */
export function parseGitRefName(value: unknown): GitRefName | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  if (!name || name.length > 200) return undefined;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) return undefined;
  if (name === "@" || name.includes("..") || name.includes("//") || name.includes("@{")) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f~^:?*[\\]/.test(name)) return undefined;
  if (name.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))) return undefined;
  return name as GitRefName;
}

export interface WorktreeBaseChoice {
  /** Short name as Git prints it: `main`, `origin/main`. */
  ref: string;
  kind: "remote" | "local";
  committedAt?: string;
}

/** What the base-branch picker offers for one project. */
export interface WorktreeBases {
  /** The ref used when nothing is chosen: the remote default branch, else `HEAD`. */
  defaultRef: string;
  /** `origin` when the project has that remote; absent means no fetch happens. */
  remote?: string;
  /** The branch the project folder has checked out, which `HEAD` means. */
  currentBranch?: string;
  /** Most recently committed first. */
  choices: WorktreeBaseChoice[];
  /** When the repository last fetched, from any tool. */
  fetchedAt?: string;
}

export type PullRequestCheckoutTarget = "worktree" | "local";

export interface StartPullRequestInput {
  projectId: string;
  number: number;
  title: string;
  url: string;
  headRefName?: string;
  target: PullRequestCheckoutTarget;
}

export function parseStartPullRequestInput(value: unknown): StartPullRequestInput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.projectId !== "string" || !input.projectId) return undefined;
  if (typeof input.number !== "number" || !Number.isInteger(input.number) || input.number < 1) return undefined;
  if (input.target !== "worktree" && input.target !== "local") return undefined;
  const url = typeof input.url === "string" && /^https:\/\/\S+$/.test(input.url) ? input.url : undefined;
  if (!url) return undefined;
  const head = input.headRefName === undefined ? undefined : parseGitRefName(input.headRefName);
  if (input.headRefName !== undefined && !head) return undefined;
  return {
    projectId: input.projectId,
    number: input.number,
    title: typeof input.title === "string" ? input.title.slice(0, 300) : "",
    url,
    ...(head ? { headRefName: head } : {}),
    target: input.target,
  };
}

/** The prompt a pull-request thread opens with. The user finishes the sentence. */
export function pullRequestDraft(input: Pick<StartPullRequestInput, "number" | "title" | "url">): string {
  const title = input.title.replace(/\s+/g, " ").trim();
  return `Working on pull request #${input.number}${title ? `: ${title}` : ""}\n${input.url}\n\n`;
}
