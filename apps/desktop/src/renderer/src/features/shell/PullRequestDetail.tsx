import { useMemo, useState } from "react";
import {
  parseUnifiedDiff,
  type GitPullRequest,
  type GitPullRequestDetail as PullRequestDetail,
  type GitPullRequestLabel,
} from "@capsule/shared";
import { MessageBody } from "../conversation/MessageBody";
import { compactRelativeTime } from "../../lib/sidebar";
import { DiffView } from "./DiffView";
import { FileDiff } from "./FileDiff";
import { ChecksBadge, PullRequestChecks } from "./PullRequestChecks";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  RefreshIcon,
  XIcon,
} from "./icons";

type PullRequestTab = "summary" | "timeline" | "code";

const TAB_LABELS: Record<PullRequestTab, string> = {
  summary: "Summary",
  timeline: "Timeline",
  code: "Code",
};

interface StagedComment {
  id: string;
  filePath: string;
  line: number;
  text: string;
}

function dateLabel(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : compactRelativeTime(value);
}

function exactDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toLocaleString();
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut + 1);
}

function nameOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}

/**
 * Labels in the colours the repository chose for them.
 *
 * The colour is the label's whole point — green for a vouched author, orange
 * for a large change — and this rendered every one of them the same grey. The
 * dot carries the colour rather than the pill: a repository is free to pick
 * something unreadable against either theme, and a dot cannot be unreadable.
 */
function LabelPills({ values, empty }: { values: GitPullRequestLabel[]; empty: string }) {
  if (values.length === 0) return <b className="faint">{empty}</b>;
  return (
    <b className="pr-pills">
      {values.map((label) => (
        <span
          className="pr-pill pr-label"
          key={label.name}
          title={label.description ? `${label.name} — ${label.description}` : label.name}
        >
          {label.color ? (
            <span className="pr-label-dot" style={{ background: `#${label.color}` }} aria-hidden />
          ) : null}
          {label.name}
        </span>
      ))}
    </b>
  );
}

/*
 * Initials, coloured from the name itself.
 *
 * Shown when there is no avatar — offline, a fetch that failed, an account
 * with no picture. A blank circle says nothing; two letters in a stable colour
 * still tells you two comments came from the same person.
 */
function initialsOf(login: string): string {
  const parts = login.split(/[-_. ]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function hueOf(login: string): number {
  let hash = 0;
  for (let index = 0; index < login.length; index += 1) {
    hash = (hash * 31 + login.charCodeAt(index)) % 360;
  }
  return hash;
}

export function Avatar({
  login,
  avatars,
  size = 20,
}: {
  login?: string;
  avatars?: Record<string, string>;
  size?: number;
}) {
  if (!login) return null;
  const src = avatars?.[login];
  const style = { width: size, height: size } as const;
  if (src) {
    return <img className="pr-avatar" src={src} alt="" title={login} style={style} />;
  }
  return (
    <span
      className="pr-avatar pr-avatar--initials"
      title={login}
      aria-hidden
      style={{ ...style, background: `hsl(${hueOf(login)} 45% 32%)`, fontSize: size * 0.42 }}
    >
      {initialsOf(login)}
    </span>
  );
}

/** A person, as a face and a name. */
function Actor({
  login,
  avatars,
  size = 20,
}: {
  login?: string;
  avatars?: Record<string, string>;
  size?: number;
}) {
  if (!login) return null;
  return (
    <span className="pr-actor">
      <Avatar login={login} avatars={avatars} size={size} />
      <span className="pr-actor-name">{login}</span>
    </span>
  );
}

function ActorPills({
  values,
  avatars,
  empty,
}: {
  values: string[];
  avatars?: Record<string, string>;
  empty: string;
}) {
  if (values.length === 0) return <b className="faint">{empty}</b>;
  return (
    <b className="pr-pills">
      {values.map((login) => (
        <span className="pr-pill pr-pill--actor" key={login}>
          <Actor login={login} avatars={avatars} size={16} />
        </span>
      ))}
    </b>
  );
}

export function GitPullRequestDetail({
  summary,
  detail,
  loading,
  onBack,
  onOpenBrowser,
  onSteerAgent,
}: {
  summary: GitPullRequest;
  detail?: PullRequestDetail;
  loading: boolean;
  onBack: () => void;
  onOpenBrowser: () => void;
  onSteerAgent?: (prompt: string) => void;
}) {
  const [tab, setTab] = useState<PullRequestTab>("summary");
  const [newestFirst, setNewestFirst] = useState(false);
  const [split, setSplit] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false);
  const [reviewSummary, setReviewSummary] = useState("");
  const [stagedComments, setStagedComments] = useState<StagedComment[]>([]);
  const [quickComment, setQuickComment] = useState("");
  const [copiedNotification, setCopiedNotification] = useState("");

  // Accordion open states
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  const [checksOpen, setChecksOpen] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(true);

  // Expand all files state
  const [allOpen, setAllOpen] = useState(true);

  const diffFiles = useMemo(() => parseUnifiedDiff(detail?.diff ?? ""), [detail?.diff]);

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

  const shownTimeline = useMemo(
    () => (newestFirst ? [...timeline].reverse() : timeline),
    [timeline, newestFirst],
  );

  const showToast = (msg: string) => {
    setCopiedNotification(msg);
    setTimeout(() => setCopiedNotification(""), 2500);
  };

  const handleCopyLink = () => {
    if (summary.url) {
      navigator.clipboard.writeText(summary.url);
      showToast("Link copied to clipboard");
    }
    setMenuOpen(false);
  };

  const handleAddComment = (filePath: string, line: number) => {
    const text = prompt(`Add inline comment for ${filePath}:${line}`);
    if (text?.trim()) {
      setStagedComments((prev) => [
        ...prev,
        { id: `c-${Date.now()}`, filePath, line, text: text.trim() },
      ]);
      setReviewDrawerOpen(true);
    }
  };

  const removeStagedComment = (id: string) => {
    setStagedComments((prev) => prev.filter((c) => c.id !== id));
  };

  const handleReviewAction = (action: "comment" | "approve" | "request_changes") => {
    let summaryText = reviewSummary.trim();
    if (stagedComments.length > 0) {
      const lineNotes = stagedComments
        .map((c) => `- \`${c.filePath}:${c.line}\`: ${c.text}`)
        .join("\n");
      summaryText = summaryText
        ? `${summaryText}\n\nLine comments:\n${lineNotes}`
        : `Line comments:\n${lineNotes}`;
    }

    if (onSteerAgent) {
      const promptText =
        action === "approve"
          ? `I reviewed PR #${summary.number}: Approved! ${summaryText}`
          : action === "request_changes"
            ? `Please fix the following findings in PR #${summary.number}:\n${summaryText}`
            : `Review comments on PR #${summary.number}:\n${summaryText}`;
      onSteerAgent(promptText);
      showToast(`Review sent to agent thread`);
    } else {
      navigator.clipboard.writeText(
        `PR #${summary.number} Review (${action.toUpperCase()}):\n${summaryText}`,
      );
      showToast("Review copied to clipboard");
    }

    setReviewSummary("");
    setStagedComments([]);
    setReviewDrawerOpen(false);
  };

  const handleExplainPR = () => {
    const prompt = `Please explain PR #${summary.number} (${summary.title}) and walk through the diff. Highlight key architectural changes and what to review closely.`;
    if (onSteerAgent) onSteerAgent(prompt);
    else {
      navigator.clipboard.writeText(prompt);
      showToast("Prompt copied to clipboard");
    }
    setMenuOpen(false);
  };

  const handleFixFindings = () => {
    const prompt = `Please inspect PR #${summary.number} and fix any outstanding issues or review comments.`;
    if (onSteerAgent) onSteerAgent(prompt);
    else {
      navigator.clipboard.writeText(prompt);
      showToast("Prompt copied to clipboard");
    }
    setMenuOpen(false);
  };

  const handleAskQuestion = () => {
    const prompt = `Regarding PR #${summary.number} (${summary.title}): `;
    if (onSteerAgent) onSteerAgent(prompt);
    else {
      navigator.clipboard.writeText(prompt);
      showToast("Prompt copied to clipboard");
    }
    setMenuOpen(false);
  };

  return (
    <section className="pr-detail">
      {copiedNotification && (
        <div className="pr-toast-notification">{copiedNotification}</div>
      )}

      <div className="pr-detail-actions">
        <button className="ghost" type="button" onClick={onBack}>
          ← Pull requests
        </button>
        <div className="pr-action-button-group">
          <button className="chip" type="button" onClick={onOpenBrowser}>
            <ExternalLinkIcon size={12} /> Open in Browser
          </button>
          <div className="pr-menu-wrapper">
            <button
              className="ghost pr-icon-btn"
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              title="More options"
            >
              <MoreHorizontalIcon size={15} />
            </button>
            {menuOpen && (
              <div className="pr-action-menu">
                <button
                  type="button"
                  className="pr-action-item"
                  onClick={handleAskQuestion}
                >
                  <span>❓</span> Ask a question
                </button>
                <button
                  type="button"
                  className="pr-action-item"
                  onClick={handleExplainPR}
                >
                  <span>📖</span> Explain this PR
                </button>
                <button
                  type="button"
                  className="pr-action-item"
                  onClick={handleFixFindings}
                >
                  <span>🔨</span> Fix findings in this thread
                </button>
                <hr className="pr-menu-divider" />
                <button
                  type="button"
                  className="pr-action-item"
                  onClick={handleCopyLink}
                >
                  <CopyIcon size={13} /> Copy link
                </button>
                <button
                  type="button"
                  className="pr-action-item"
                  onClick={() => {
                    onOpenBrowser();
                    setMenuOpen(false);
                  }}
                >
                  <ExternalLinkIcon size={13} /> Open on GitHub
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pr-detail-hero">
        <div className="pr-detail-kicker">
          <div className="pr-kicker-left">
            <span className="pr-number">#{summary.number}</span>
            <span className={`codex-pr-checks ${summary.checks ?? "none"}`}>
              {summary.isDraft ? "Draft" : summary.checks ?? summary.state}
            </span>
          </div>
          {/*
            * The tally lives with the tabs, and only there. It was also here,
            * a hundred pixels above the same words — the same fact twice on
            * one screen, which reads as two facts until you compare them.
            */}
        </div>
        <h3>{summary.title}</h3>
        <p className="pr-byline" title={exactDate(summary.updatedAt)}>
          {summary.author ? (
            <Actor login={summary.author} avatars={detail?.avatars} size={18} />
          ) : null}
          {summary.author && dateLabel(summary.updatedAt) ? <span aria-hidden>·</span> : null}
          <span>{dateLabel(summary.updatedAt) || (summary.author ? "" : summary.state)}</span>
        </p>
        <div className="pr-branch-line mono">
          <span title={detail?.baseRefName}>{detail?.baseRefName ?? "base"}</span>
          <span>←</span>
          <span title={summary.headRefName}>{summary.headRefName ?? "head"}</span>
          {detail ? (
            <span className="pr-diff-stat">
              {detail.changedFiles} files{" "}
              <i className="pr-add">+{detail.additions}</i>{" "}
              <b className="pr-del">−{detail.deletions}</b>
            </span>
          ) : null}
        </div>
      </div>

      <div className="pr-tabrow">
        <div className="pr-tabs" role="tablist" aria-label="Pull request detail">
          {(["summary", "timeline", "code"] as const).map((value) => (
            <button
              type="button"
              role="tab"
              id={`pr-tab-${value}`}
              aria-selected={tab === value}
              aria-controls={`pr-panel-${value}`}
              className={tab === value ? "active" : ""}
              key={value}
              onClick={() => setTab(value)}
            >
              {TAB_LABELS[value]}
            </button>
          ))}
        </div>
        {detail ? <ChecksBadge checks={detail.checkRuns} /> : null}
      </div>

      {loading && !detail ? <p className="faint pr-loading">Loading pull request…</p> : null}
      {!loading && !detail ? (
        <p className="notice">GitHub did not return details for this pull request.</p>
      ) : null}

      {detail && tab === "summary" ? (
        <div className="pr-summary" role="tabpanel" id="pr-panel-summary" aria-labelledby="pr-tab-summary">
          <div className="pr-meta-grid">
            <div>
              <span>Reviewers</span>
              <ActorPills values={detail.reviewers} avatars={detail.avatars} empty="None yet" />
            </div>
            <div>
              <span>Labels</span>
              <LabelPills values={detail.labels} empty="None" />
            </div>
            <div>
              <span>Comments</span>
              <b>{detail.activity.length}</b>
            </div>
            <div>
              <span>Review</span>
              <b>{detail.reviewDecision || "Not decided"}</b>
            </div>
          </div>

          <section className="pr-accordion-section">
            <button
              type="button"
              className="pr-accordion-header"
              onClick={() => setDescriptionOpen((v) => !v)}
              aria-expanded={descriptionOpen}
            >
              <span className="pr-accordion-caret">
                {descriptionOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              </span>
              <h4>Description</h4>
            </button>
            {descriptionOpen && (
              <div className="pr-accordion-content">
                {detail.body.trim() ? (
                  <MessageBody content={detail.body} />
                ) : (
                  <p className="faint">No description provided.</p>
                )}
              </div>
            )}
          </section>

          <section className="pr-accordion-section">
            <button
              type="button"
              className="pr-accordion-header"
              onClick={() => setChecksOpen((v) => !v)}
              aria-expanded={checksOpen}
            >
              <span className="pr-accordion-caret">
                {checksOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              </span>
              <h4>Checks</h4>
              {/* A count, the way Comments below it does: the pass tally is
                  already stated beside the tabs. */}
              <span className="faint pr-accordion-badge">{detail.checkRuns.length}</span>
            </button>
            {checksOpen && (
              <div className="pr-accordion-content">
                <PullRequestChecks checks={detail.checkRuns} />
              </div>
            )}
          </section>

          <section className="pr-accordion-section">
            <button
              type="button"
              className="pr-accordion-header"
              onClick={() => setCommentsOpen((v) => !v)}
              aria-expanded={commentsOpen}
            >
              <span className="pr-accordion-caret">
                {commentsOpen ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
              </span>
              <h4>Comments</h4>
              <span className="faint pr-accordion-badge">
                {detail.activity.length}
              </span>
            </button>
            {commentsOpen && (
              <div className="pr-accordion-content">
                {detail.activity.length === 0 ? (
                  <p className="faint">No comments on this pull request yet.</p>
                ) : (
                  <div className="pr-comments-list">
                    {detail.activity.map((act) => (
                      <div key={act.id} className="pr-comment-row">
                        <div className="pr-comment-header">
                          <b>{act.author || "Reviewer"}</b>
                          <time>{dateLabel(act.createdAt)}</time>
                        </div>
                        <p>{act.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="pr-quick-comment-box">
            <textarea
              placeholder="Leave a comment..."
              rows={2}
              value={quickComment}
              onChange={(e) => setQuickComment(e.target.value)}
            />
            <div className="pr-quick-comment-actions">
              <button
                type="button"
                className="chip"
                disabled={!quickComment.trim()}
                onClick={() => {
                  if (onSteerAgent) {
                    onSteerAgent(`Comment on PR #${summary.number}: ${quickComment.trim()}`);
                    showToast("Comment sent to agent thread");
                  } else {
                    navigator.clipboard.writeText(quickComment.trim());
                    showToast("Comment copied to clipboard");
                  }
                  setQuickComment("");
                }}
              >
                Comment
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detail && tab === "timeline" ? (
        <div className="pr-timeline" role="tabpanel" id="pr-panel-timeline" aria-labelledby="pr-tab-timeline">
          <div className="pr-toolbar">
            <span className="faint">
              {detail.activity.length} comments · {detail.commits.length} commits
            </span>
            <button
              type="button"
              className="chip"
              aria-pressed={newestFirst}
              onClick={() => setNewestFirst((value) => !value)}
            >
              {newestFirst ? "Newest first" : "Oldest first"}
            </button>
          </div>
          {shownTimeline.length === 0 ? <p className="faint">No activity was returned.</p> : null}
          {shownTimeline.map((item) => (
            <article key={item.id}>
              {/* The face replaces the dot: it marks the row in the same
                  place and says who, which the dot never did. */}
              {item.author ? (
                <Avatar login={item.author} avatars={detail.avatars} size={22} />
              ) : (
                <div className="pr-timeline-dot" aria-hidden />
              )}
              <div className="pr-timeline-head">
                <b title={item.author || item.kind}>{item.author || item.kind}</b>
                <span>{item.title}</span>
                {item.sha ? <code>{item.sha}</code> : null}
                <time title={exactDate(item.at)}>{dateLabel(item.at)}</time>
              </div>
              {item.body ? <MessageBody content={item.body} /> : null}
            </article>
          ))}
        </div>
      ) : null}

      {detail && tab === "code" ? (
        <div className="pr-code" role="tabpanel" id="pr-panel-code" aria-labelledby="pr-tab-code">
          <div className="pr-toolbar pr-code-toolbar">
            <div className="pr-code-toolbar-left">
              <span className="chip faint">All commits ▾</span>
              <span className="faint">
                {detail.changedFiles} files <i className="pr-add">+{detail.additions}</i>{" "}
                <b className="pr-del">−{detail.deletions}</b>
              </span>
            </div>
            <div className="pr-code-toolbar-right">
              <button
                type="button"
                className="chip"
                onClick={() => setAllOpen((v) => !v)}
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={split}
                onClick={() => setSplit((value) => !value)}
                title="Toggle Split / Unified view"
              >
                {split ? "Split" : "Unified"}
              </button>
            </div>
          </div>

          {diffFiles.length > 0 ? (
            <div className="pr-file-diffs">
              {diffFiles.map((file) => (
                <FileDiff
                  key={`${file.oldPath ?? ""}->${file.path}`}
                  file={file}
                  split={split}
                  defaultOpen={allOpen}
                  onAddComment={handleAddComment}
                />
              ))}
            </div>
          ) : detail.diff.trim() ? (
            <DiffView text={detail.diff} />
          ) : (
            <div className="pr-nodiff">
              <p className="notice">
                {detail.diffUnavailable ?? "GitHub returned no diff for this pull request."}
              </p>
              {detail.files.length > 0 ? (
                <>
                  <p className="faint">
                    Showing {detail.files.length} of {detail.changedFiles} changed files.
                  </p>
                  <div className="pr-file-list">
                    {detail.files.map((file) => (
                      <div key={file.path}>
                        <span className="mono pr-file-path" title={file.path}>
                          <span className="pr-file-dir">{dirOf(file.path)}</span>
                          <span className="pr-file-name">{nameOf(file.path)}</span>
                        </span>
                        <span className="pr-diff-stat">
                          <i>+{file.additions}</i> <b>−{file.deletions}</b>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* Floating Review Button */}
          <button
            type="button"
            className="pr-floating-review-btn"
            onClick={() => setReviewDrawerOpen((v) => !v)}
          >
            <MessageSquareIcon size={14} /> Review
            {stagedComments.length > 0 && (
              <span className="pr-staged-count-badge">{stagedComments.length}</span>
            )}
          </button>

          {/* Floating Review Drawer */}
          {reviewDrawerOpen && (
            <div className="pr-review-drawer">
              <div className="pr-review-drawer-head">
                <b>Review changes</b>
                <button
                  type="button"
                  className="ghost pr-icon-btn"
                  onClick={() => setReviewDrawerOpen(false)}
                >
                  <XIcon size={14} />
                </button>
              </div>

              <div className="pr-review-drawer-body">
                {stagedComments.length === 0 ? (
                  <p className="faint pr-review-empty">No line comments yet</p>
                ) : (
                  <div className="pr-staged-comments-list">
                    {stagedComments.map((c) => (
                      <div key={c.id} className="pr-staged-comment-item">
                        <div className="pr-staged-comment-meta">
                          <code className="mono">{c.filePath}:{c.line}</code>
                          <button
                            type="button"
                            className="ghost pr-icon-btn"
                            onClick={() => removeStagedComment(c.id)}
                            title="Remove comment"
                          >
                            <XIcon size={12} />
                          </button>
                        </div>
                        <p>{c.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                <textarea
                  className="pr-review-textarea"
                  placeholder="Summarize your review (optional)..."
                  rows={3}
                  value={reviewSummary}
                  onChange={(e) => setReviewSummary(e.target.value)}
                />
              </div>

              <div className="pr-review-drawer-footer">
                <button
                  type="button"
                  className="chip"
                  onClick={() => handleReviewAction("comment")}
                >
                  <MessageSquareIcon size={12} /> Comment
                </button>
                <button
                  type="button"
                  className="pr-btn-approve"
                  onClick={() => handleReviewAction("approve")}
                >
                  <CheckIcon size={12} /> Approve
                </button>
                <button
                  type="button"
                  className="pr-btn-request-changes"
                  onClick={() => handleReviewAction("request_changes")}
                >
                  <XIcon size={12} /> Request changes
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
