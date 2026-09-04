import { useMemo } from "react";
import type { GitPullRequestActivity, GitPullRequestDetail } from "@capsule/shared";
import { compactRelativeTime } from "../../lib/sidebar";
import { activityTime, pullRequestTimeline, reviewStateLabel } from "../../lib/pull-request-activity";
import { MarkdownBody } from "../conversation/MessageBody";
import { ChevronDownIcon, GitBranchIcon } from "./icons";

export function ActivityTime({ value }: { value?: string }) {
  if (!value || !activityTime(value)) return null;
  return <time dateTime={value} title={new Date(value).toLocaleString()}>{compactRelativeTime(value)}</time>;
}

export function Avatar({ login, avatars, size = 20 }: { login?: string; avatars?: Record<string, string>; size?: number }) {
  if (!login) return null;
  const parts = login.split(/[-_. ]+/).filter(Boolean);
  const initials = (parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : login.slice(0, 2)).toUpperCase();
  const style = { width: size, height: size };
  return avatars?.[login]
    ? <img className="pr-avatar" src={avatars[login]} alt="" title={login} style={style} />
    : <span className="pr-avatar pr-avatar--initials" title={login} aria-hidden style={{ ...style, background: "var(--surface-2)", color: "var(--text-muted)", fontSize: `${size * 0.42 / 16}rem` }}>{initials}</span>;
}

export function PullRequestComment({ activity, avatars, baseUrl, onOpenUrl, defaultOpen = true }: {
  activity: GitPullRequestActivity;
  avatars?: Record<string, string>;
  baseUrl: string;
  onOpenUrl: (url: string) => void;
  defaultOpen?: boolean;
}) {
  const body = activity.body.trim();
  return <details className="pr-comment-card" open={defaultOpen && Boolean(body)}>
    <summary>
      <Avatar login={activity.author} avatars={avatars} size={20} />
      <b>{activity.author || "Reviewer"}</b>
      <ActivityTime value={activity.createdAt} />
      <span className="pr-activity-state">{activity.kind === "review" ? reviewStateLabel(activity.state) : "Comment"}</span>
      <ChevronDownIcon size={13} className="pr-disclosure-caret" />
    </summary>
    <div className="pr-comment-content">
      {body ? <MarkdownBody content={body} githubBaseUrl={baseUrl} onOpenLink={onOpenUrl} /> : <p className="faint">No written comment.</p>}
    </div>
  </details>;
}

export function PullRequestTimeline({ detail, newestFirst, onSelectCommit, onOpenUrl }: {
  detail: GitPullRequestDetail;
  newestFirst: boolean;
  onSelectCommit: (oid: string) => void;
  onOpenUrl: (url: string) => void;
}) {
  const groups = useMemo(() => pullRequestTimeline(detail, newestFirst), [detail, newestFirst]);
  return <div className="pr-timeline-events">
    {groups.map((group) => {
      const first = group.items[0]!;
      const authors = new Set(group.items.map((item) => item.author).filter(Boolean));
      const marker = first.kind === "commit" || first.kind === "conversation"
        ? <Avatar login={first.author} avatars={detail.avatars} size={22} />
        : <GitBranchIcon size={16} />;
      return <article key={group.id}>
        <span className="pr-timeline-marker">{marker}</span>
        {group.kind === "conversation" ? (
          group.items.length === 1 ? <PullRequestComment activity={first.activity!} avatars={detail.avatars} baseUrl={detail.url} onOpenUrl={onOpenUrl} /> : (
            <details className="pr-conversation-group">
              <summary>
                <span><b>{group.items.length} comments and reviews</b><small>{authors.size} {authors.size === 1 ? "author" : "authors"} · <ActivityTime value={first.at} /></small></span>
                <ChevronDownIcon size={14} className="pr-disclosure-caret" />
              </summary>
              <div className="pr-comments-list">{group.items.map((item) => <PullRequestComment key={item.id} activity={item.activity!} avatars={detail.avatars} baseUrl={detail.url} onOpenUrl={onOpenUrl} />)}</div>
            </details>
          )
        ) : (
          <div className="pr-timeline-event">
            {first.oid ? <button type="button" className="pr-commit-link" title={first.title} onClick={() => onSelectCommit(first.oid!)}>{first.title}</button> : <b>{first.title}</b>}
            <div className="pr-event-meta">{first.author ? <span>{first.author}</span> : null}{first.oid ? <code>{first.oid.slice(0, 7)}</code> : null}<ActivityTime value={first.at} /></div>
            {first.body ? <details className="pr-commit-message"><summary>Commit message</summary><MarkdownBody content={first.body} githubBaseUrl={detail.url} onOpenLink={onOpenUrl} /></details> : null}
          </div>
        )}
      </article>;
    })}
  </div>;
}
