import type { GitPullRequest } from "@capsule/shared";

export type PullRequestSort = "updated" | "created";

export function visiblePullRequests(
  items: GitPullRequest[],
  query: string,
  sort: PullRequestSort,
): GitPullRequest[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const text = `#${item.number} ${item.title} ${item.author ?? ""} ${item.headRefName ?? ""}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => {
    const stamp = (item: GitPullRequest) => {
      const time = Date.parse((sort === "created" ? item.createdAt : item.updatedAt) ?? "");
      return Number.isFinite(time) ? time : 0;
    };
    return stamp(b) - stamp(a) || b.number - a.number;
  });
}
