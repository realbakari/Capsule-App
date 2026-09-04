import type { GitPullRequestActivity, GitPullRequestDetail } from "@capsule/shared";

export function activityTime(value?: string): number {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : 0;
}

export function reviewStateLabel(state?: string): string {
  if (!state) return "Review";
  return state.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export type PullRequestTimelineItem = {
  id: string;
  kind: "opened" | "commit" | "conversation" | "merged" | "closed";
  at?: string;
  title: string;
  author?: string;
  body?: string;
  oid?: string;
  activity?: GitPullRequestActivity;
};

export type PullRequestTimelineGroup = {
  id: string;
  kind: "event" | "conversation";
  items: PullRequestTimelineItem[];
};

/** Group adjacent conversation entries only; never hide a commit between them. */
export function pullRequestTimeline(detail: GitPullRequestDetail, newestFirst: boolean): PullRequestTimelineGroup[] {
  const items: PullRequestTimelineItem[] = [
    { id: `opened-${detail.number}`, kind: "opened", title: "Pull request opened", author: detail.author, at: detail.createdAt },
    ...detail.commits.map((commit): PullRequestTimelineItem => ({
      id: `commit-${commit.oid}`, kind: "commit", title: commit.title,
      author: commit.authors[0], body: commit.body, at: commit.authoredAt, oid: commit.oid,
    })),
    ...detail.activity.map((activity): PullRequestTimelineItem => ({
      id: `${activity.kind}-${activity.id}`, kind: "conversation", title: activity.kind === "review" ? reviewStateLabel(activity.state) : "Comment",
      author: activity.author, at: activity.createdAt, activity,
    })),
  ];
  // Never substitute updatedAt: a later comment is not the time of a merge.
  if (detail.mergedAt) items.push({ id: `merged-${detail.number}`, kind: "merged", title: "Pull request merged", at: detail.mergedAt });
  else if (detail.closedAt) items.push({ id: `closed-${detail.number}`, kind: "closed", title: "Pull request closed", at: detail.closedAt });
  items.sort((a, b) => activityTime(a.at) - activityTime(b.at));
  if (newestFirst) items.reverse();
  const groups: PullRequestTimelineGroup[] = [];
  for (const item of items) {
    const previous = groups.at(-1);
    if (item.kind === "conversation" && previous?.kind === "conversation") previous.items.push(item);
    else groups.push({ id: item.id, kind: item.kind === "conversation" ? "conversation" : "event", items: [item] });
  }
  return groups;
}
