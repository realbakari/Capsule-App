import { useMemo, useState } from "react";
import type { GitPullRequest, GitPullRequestDetail as PullRequestDetail } from "@capsule/shared";
import { MessageBody } from "../conversation/MessageBody";
import { DiffView } from "./DiffView";

type PullRequestTab = "summary" | "timeline" | "code";

function dateLabel(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function names(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "None";
}

export function GitPullRequestDetail({
  summary,
  detail,
  loading,
  onBack,
  onOpenBrowser,
}: {
  summary: GitPullRequest;
  detail?: PullRequestDetail;
  loading: boolean;
  onBack: () => void;
  onOpenBrowser: () => void;
}) {
  const [tab, setTab] = useState<PullRequestTab>("summary");
  const timeline = useMemo(() => {
    if (!detail) return [];
    return [
      {
        id: `opened-${detail.number}`,
        kind: "Pull request",
        title: "Opened this pull request",
        body: "",
        author: detail.author ?? "Unknown author",
        at: detail.createdAt,
        sha: "",
      },
      ...detail.commits.map((commit) => ({
        id: `commit-${commit.oid}`,
        kind: "Commit",
        title: commit.title,
        body: commit.body ?? "",
        author: commit.authors.join(", "),
        at: commit.authoredAt,
        sha: commit.oid.slice(0, 7),
      })),
      ...detail.activity.map((item) => ({
        id: `${item.kind}-${item.id}`,
        kind: item.kind === "review" ? item.state || "Review" : "Comment",
        title: item.kind === "review" ? "Reviewed this pull request" : "Commented",
        body: item.body,
        author: item.author ?? "Unknown author",
        at: item.createdAt,
        sha: "",
      })),
    ].sort((left, right) => (left.at ?? "").localeCompare(right.at ?? ""));
  }, [detail]);

  return (
    <section className="pr-detail">
      <div className="pr-detail-actions">
        <button className="ghost" type="button" onClick={onBack}>← Pull requests</button>
        <button className="chip" type="button" onClick={onOpenBrowser}>Open in Browser</button>
      </div>

      <div className="pr-detail-hero">
        <div className="pr-detail-kicker">
          <span>#{summary.number}</span>
          <span className={`codex-pr-checks ${summary.checks ?? "none"}`}>
            {summary.isDraft ? "Draft" : summary.checks ?? summary.state}
          </span>
        </div>
        <h3>{summary.title}</h3>
        <p>
          {[summary.author, dateLabel(summary.updatedAt)].filter(Boolean).join(" · ") || summary.state}
        </p>
        <div className="pr-branch-line mono">
          <span>{detail?.baseRefName ?? "base"}</span>
          <span>←</span>
          <span>{summary.headRefName ?? "head"}</span>
          {detail ? (
            <span className="pr-diff-stat">
              {detail.changedFiles} files <i>+{detail.additions}</i> <b>−{detail.deletions}</b>
            </span>
          ) : null}
        </div>
      </div>

      <div className="pr-tabs" role="tablist" aria-label="Pull request detail">
        {(["summary", "timeline", "code"] as const).map((value) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "active" : ""}
            key={value}
            onClick={() => setTab(value)}
          >
            {value[0]?.toUpperCase()}{value.slice(1)}
          </button>
        ))}
      </div>

      {loading && !detail ? <p className="faint pr-loading">Loading pull request…</p> : null}
      {!loading && !detail ? (
        <p className="notice">GitHub did not return details for this pull request.</p>
      ) : null}

      {detail && tab === "summary" ? (
        <div className="pr-summary">
          <div className="pr-meta-grid">
            <div><span>Reviewers</span><b>{names(detail.reviewers)}</b></div>
            <div><span>Labels</span><b>{names(detail.labels)}</b></div>
            <div><span>Comments</span><b>{detail.activity.length}</b></div>
            <div><span>Review</span><b>{detail.reviewDecision || "Not decided"}</b></div>
          </div>
          <section className="pr-section">
            <h4>Description</h4>
            {detail.body.trim() ? <MessageBody content={detail.body} /> : <p className="faint">No description.</p>}
          </section>
        </div>
      ) : null}

      {detail && tab === "timeline" ? (
        <div className="pr-timeline">
          {timeline.length === 0 ? <p className="faint">No activity was returned.</p> : null}
          {timeline.map((item) => (
            <article key={item.id}>
              <div className="pr-timeline-dot" aria-hidden />
              <div className="pr-timeline-head">
                <b>{item.author || item.kind}</b>
                <span>{item.title}</span>
                {item.sha ? <code>{item.sha}</code> : null}
                <time>{dateLabel(item.at)}</time>
              </div>
              {item.body ? <MessageBody content={item.body} /> : null}
            </article>
          ))}
        </div>
      ) : null}

      {detail && tab === "code" ? (
        <div className="pr-code">
          <div className="pr-file-list">
            {detail.files.map((file) => (
              <div key={file.path}>
                <span className="mono">{file.path}</span>
                <span className="pr-diff-stat"><i>+{file.additions}</i> <b>−{file.deletions}</b></span>
              </div>
            ))}
          </div>
          {detail.diff.trim() ? <DiffView text={detail.diff} /> : <p className="faint">No patch was returned.</p>}
        </div>
      ) : null}
    </section>
  );
}
