import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseUnifiedDiff,
  type GitPullRequest,
  type GitPullRequestDetail as PullRequestDetail,
  type GitPullRequestLabel,
} from "@capsule/shared";
import { MessageBody } from "../conversation/MessageBody";
import { compactRelativeTime } from "../../lib/sidebar";
import { formatUserError } from "../../lib/errors";
import { activityTime, reviewStateLabel } from "../../lib/pull-request-activity";
import { DiffView } from "./DiffView";
import { FileDiff } from "./FileDiff";
import { ChecksBadge, PullRequestChecks } from "./PullRequestChecks";
import { Avatar, PullRequestComment, PullRequestTimeline } from "./PullRequestActivity";
import {
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
  side: "left" | "right";
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
  error,
  onRefresh,
  onLoadCommitDiff,
  onBack,
  onOpenBrowser,
  onSteerAgent,
  onOpenUrl,
}: {
  summary: GitPullRequest;
  detail?: PullRequestDetail;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onLoadCommitDiff: (oid: string) => Promise<string>;
  onBack: () => void;
  onOpenBrowser: () => void;
  onSteerAgent?: (prompt: string) => void;
  onOpenUrl: (url: string) => void;
}) {
  const [tab, setTab] = useState<PullRequestTab>("summary");
  const [newestFirst, setNewestFirst] = useState(true);
  const [split, setSplit] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false);
  const [reviewSummary, setReviewSummary] = useState("");
  const [stagedComments, setStagedComments] = useState<StagedComment[]>([]);
  const [pendingComment, setPendingComment] = useState<Omit<StagedComment, "id">>();
  const [quickComment, setQuickComment] = useState("");
  const [copiedNotification, setCopiedNotification] = useState("");
  const [selectedCommit, setSelectedCommit] = useState("");
  const [commitDiff, setCommitDiff] = useState("");
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState<string>();
  const commitRequest = useRef(0);
  useEffect(() => () => { commitRequest.current += 1; }, []);

  async function selectCommit(oid: string) {
    const request = ++commitRequest.current;
    setSelectedCommit(oid);
    setCommitDiff("");
    setCommitError(undefined);
    setCommitLoading(Boolean(oid));
    if (!oid) return;
    try {
      const diff = await onLoadCommitDiff(oid);
      if (request === commitRequest.current) setCommitDiff(diff);
    } catch (error) {
      if (request === commitRequest.current) setCommitError(formatUserError(error));
    } finally {
      if (request === commitRequest.current) setCommitLoading(false);
    }
  }

  // Accordion open states
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  const [checksOpen, setChecksOpen] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(true);

  // Expand all files state
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  const shownDiff = selectedCommit ? commitDiff : detail?.diff ?? "";
  const diffFiles = useMemo(() => parseUnifiedDiff(shownDiff), [shownDiff]);
  const diffStats = selectedCommit
    ? { changedFiles: diffFiles.length, additions: diffFiles.reduce((sum, file) => sum + file.additions, 0), deletions: diffFiles.reduce((sum, file) => sum + file.deletions, 0) }
    : detail;
  const allOpen = diffFiles.every((file) => !collapsedFiles.has(file.path));

  const shownComments = useMemo(() => [...(detail?.activity ?? [])].sort((a, b) =>
    (activityTime(a.createdAt) - activityTime(b.createdAt)) * (newestFirst ? -1 : 1)), [detail?.activity, newestFirst]);

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

  const handleAddComment = (filePath: string, line: number, side: "left" | "right") => {
    if (pendingComment?.text.trim()) {
      showToast("Save or cancel the current note before starting another.");
      return;
    }
    setPendingComment({ filePath, line, side, text: "" });
    setReviewDrawerOpen(true);
  };

  const removeStagedComment = (id: string) => {
    setStagedComments((prev) => prev.filter((c) => c.id !== id));
  };

  const handleReviewAction = async (copy = false) => {
    let summaryText = reviewSummary.trim();
    if (stagedComments.length > 0) {
      const lineNotes = stagedComments
        .map((c) => `- \`${c.filePath}:${c.line}\` (${c.side === "left" ? "old" : "new"} side): ${c.text}`)
        .join("\n");
      summaryText = summaryText
        ? `${summaryText}\n\nLine comments:\n${lineNotes}`
        : `Line comments:\n${lineNotes}`;
    }

    if (!summaryText) return;
    const promptText = `Review notes for ${summary.url}:\n${summaryText}`;
    try {
      if (onSteerAgent && !copy) {
        onSteerAgent(promptText);
        showToast("Review notes added to the thread draft");
      } else {
        await navigator.clipboard.writeText(promptText);
        showToast("Review notes copied");
      }
    } catch {
      showToast("Could not copy the notes. Your draft has been kept.");
      return;
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
          <button className="pr-icon-btn" type="button" disabled={loading || commitLoading} title={error ? "Retry loading pull request" : "Refresh pull request"} aria-label={loading ? "Refreshing pull request" : error ? "Retry loading pull request" : "Refresh pull request"} onClick={() => {
            onRefresh();
            if (selectedCommit) void selectCommit(selectedCommit);
          }}>
            <RefreshIcon size={15} />
          </button>
          <button className="pr-icon-btn" type="button" onClick={onOpenBrowser} title="Open on GitHub" aria-label="Open on GitHub">
            <ExternalLinkIcon size={15} />
          </button>
          <div className="pr-menu-wrapper">
            <button
              className="ghost pr-icon-btn"
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              title="More options"
              aria-label="More pull request options"
              aria-expanded={menuOpen}
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
            <span className="codex-pr-checks">
              {(detail ?? summary).isDraft ? "Draft" : (detail ?? summary).state.toLowerCase().replace(/^./, (letter) => letter.toUpperCase())}
            </span>
          </div>
          {/*
            * The tally lives with the tabs, and only there. It was also here,
            * a hundred pixels above the same words — the same fact twice on
            * one screen, which reads as two facts until you compare them.
            */}
        </div>
        <h3>{detail?.title ?? summary.title}</h3>
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
      {error ? <p className="notice" role="alert">{error}{detail ? " Showing the last successful result." : ""}</p> : null}
      {!loading && !detail && !error ? (
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
              <b>{detail.reviewDecision ? reviewStateLabel(detail.reviewDecision) : "Not decided"}</b>
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
                  <MessageBody content={detail.body} githubBaseUrl={summary.url} />
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
                <PullRequestChecks checks={detail.checkRuns} onOpenUrl={onOpenUrl} />
              </div>
            )}
          </section>

          <section className="pr-accordion-section">
            <div className="pr-section-heading">
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
            <button type="button" className="pr-sort-button" aria-pressed={newestFirst} onClick={() => setNewestFirst((value) => !value)}>{newestFirst ? "Newest first" : "Oldest first"}</button>
            </div>
            {commentsOpen && (
              <div className="pr-accordion-content">
                {detail.activity.length === 0 ? (
                  <p className="faint">No comments on this pull request yet.</p>
                ) : (
                  <div className="pr-comments-list">
                    {shownComments.map((act) => <PullRequestComment key={`${act.kind}-${act.id}`} activity={act} avatars={detail.avatars} baseUrl={summary.url} onOpenUrl={onOpenUrl} />)}
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="pr-quick-comment-box">
            <textarea
              aria-label="Comment draft for the thread"
              placeholder="Draft a comment for the thread…"
              rows={2}
              value={quickComment}
              onChange={(e) => setQuickComment(e.target.value)}
            />
            <div className="pr-quick-comment-actions">
              <button
                type="button"
                className="chip"
                disabled={!quickComment.trim()}
                onClick={async () => {
                  try {
                    if (onSteerAgent) {
                      onSteerAgent(`Comment draft for ${summary.url}: ${quickComment.trim()}`);
                      showToast("Comment added to the thread draft");
                    } else {
                      await navigator.clipboard.writeText(quickComment.trim());
                      showToast("Comment copied to clipboard");
                    }
                    setQuickComment("");
                  } catch {
                    showToast("Could not copy the comment. Your draft has been kept.");
                  }
                }}
              >
                {onSteerAgent ? "Use in thread" : "Copy draft"}
              </button>
            </div>
            <p className="faint">Drafts are not posted to GitHub. Open on GitHub to submit a review there.</p>
          </div>
        </div>
      ) : null}

      {detail && tab === "timeline" ? (
        <div className="pr-timeline" role="tabpanel" id="pr-panel-timeline" aria-labelledby="pr-tab-timeline">
          <div className="pr-toolbar">
            <span className="faint">
                {detail.activity.length} {detail.activity.length === 1 ? "comment" : "comments"} · {detail.commits.length} {detail.commits.length === 1 ? "commit" : "commits"}
            </span>
            <button
              type="button"
              className="pr-sort-button"
              aria-pressed={newestFirst}
              onClick={() => setNewestFirst((value) => !value)}
            >
              {newestFirst ? "Newest first" : "Oldest first"}
            </button>
          </div>
          <PullRequestTimeline detail={detail} newestFirst={newestFirst} onOpenUrl={onOpenUrl} onSelectCommit={(oid) => { setTab("code"); void selectCommit(oid); }} />
        </div>
      ) : null}

      {detail && tab === "code" ? (
        <div className="pr-code" role="tabpanel" id="pr-panel-code" aria-labelledby="pr-tab-code">
          <div className="pr-toolbar pr-code-toolbar">
            <div className="pr-code-toolbar-left">
              <select aria-label="Commit to review" className="pr-commit-select" value={selectedCommit} onChange={(event) => void selectCommit(event.target.value)}>
                <option value="">All commits</option>
                {[...detail.commits].reverse().map((commit) => (
                  <option key={commit.oid} value={commit.oid}>{commit.oid.slice(0, 7)} · {commit.title}</option>
                ))}
              </select>
              {!commitLoading && !commitError && diffStats ? <span className="faint">
                {diffStats.changedFiles} files <i className="pr-add">+{diffStats.additions}</i>{" "}
                <b className="pr-del">−{diffStats.deletions}</b>
              </span> : null}
            </div>
            <div className="pr-code-toolbar-right">
              <button
                type="button"
                className="chip"
                onClick={() => setCollapsedFiles(allOpen ? new Set(diffFiles.map((file) => file.path)) : new Set())}
                disabled={diffFiles.length === 0}
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
              <div className="pr-view-toggle" role="group" aria-label="Diff layout">
                <button type="button" aria-pressed={!split} onClick={() => setSplit(false)}>Unified</button>
                <button type="button" aria-pressed={split} onClick={() => setSplit(true)}>Split</button>
              </div>
              <button type="button" className="pr-wrap-toggle" aria-pressed={wrap} onClick={() => setWrap((value) => !value)} title="Wrap long lines to fit the panel">Wrap lines</button>
            </div>
          </div>

          {selectedCommit ? <p className="faint">Viewing this commit's changes. Choose All commits to add line notes for the pull request.</p> : null}
          {commitLoading ? <p className="faint" role="status">Loading commit diff…</p> : null}
          {commitError ? <div className="notice" role="alert">{commitError} <button className="chip" type="button" onClick={() => void selectCommit(selectedCommit)}>Retry diff</button></div> : null}

          {diffFiles.length > 0 ? (
            <div className="pr-file-diffs">
              {diffFiles.map((file) => (
                <FileDiff
                  key={`${file.oldPath ?? ""}->${file.path}`}
                  file={file}
                  split={split}
                  wrap={wrap}
                  expanded={!collapsedFiles.has(file.path)}
                  onExpandedChange={(open) => setCollapsedFiles((previous) => {
                    const next = new Set(previous);
                    if (open) next.delete(file.path);
                    else next.add(file.path);
                    return next;
                  })}
                  onAddComment={selectedCommit ? undefined : handleAddComment}
                />
              ))}
            </div>
          ) : shownDiff.trim() ? (
            <DiffView text={shownDiff} />
          ) : !commitLoading && !commitError ? (
            <div className="pr-nodiff">
              <p className="notice">
                {selectedCommit ? "This commit has no text diff." : detail.diffUnavailable ?? "GitHub returned no diff for this pull request."}
              </p>
              {!selectedCommit && detail.files.length > 0 ? (
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
          ) : null}

          {/* Floating Review Button */}
          <button
            type="button"
            className="pr-floating-review-btn"
            onClick={() => setReviewDrawerOpen((v) => !v)}
          >
            <MessageSquareIcon size={14} /> Review notes
            {stagedComments.length > 0 && (
              <span className="pr-staged-count-badge">{stagedComments.length}</span>
            )}
          </button>

          {/* Floating Review Drawer */}
          {reviewDrawerOpen && (
            <div className="pr-review-drawer">
              <div className="pr-review-drawer-head">
                <b>Review notes</b>
                <button
                  type="button"
                  className="ghost pr-icon-btn"
                  onClick={() => setReviewDrawerOpen(false)}
                  aria-label="Close review notes"
                >
                  <XIcon size={14} />
                </button>
              </div>

              <div className="pr-review-drawer-body">
                <p className="faint">Notes stay in this view until you copy them or add them to the thread draft. They are not submitted to GitHub.</p>
                {pendingComment ? (
                  <div className="pr-pending-note">
                    <label htmlFor="pr-line-note">{pendingComment.filePath}:{pendingComment.line} ({pendingComment.side === "left" ? "old" : "new"} side)</label>
                    <textarea id="pr-line-note" autoFocus rows={3} value={pendingComment.text} onChange={(event) => setPendingComment({ ...pendingComment, text: event.target.value })} />
                    <button type="button" className="chip" disabled={!pendingComment.text.trim()} onClick={() => {
                      setStagedComments((previous) => [...previous, { ...pendingComment, text: pendingComment.text.trim(), id: crypto.randomUUID() }]);
                      setPendingComment(undefined);
                    }}>Add note</button>
                    <button type="button" className="ghost" onClick={() => setPendingComment(undefined)}>Cancel</button>
                  </div>
                ) : null}
                {stagedComments.length === 0 ? (
                  <p className="faint pr-review-empty">No line comments yet</p>
                ) : (
                  <div className="pr-staged-comments-list">
                    {stagedComments.map((c) => (
                      <div key={c.id} className="pr-staged-comment-item">
                        <div className="pr-staged-comment-meta">
                          <code className="mono">{c.filePath}:{c.line} ({c.side === "left" ? "old" : "new"})</code>
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
                  aria-label="Review summary draft"
                  rows={3}
                  value={reviewSummary}
                  onChange={(e) => setReviewSummary(e.target.value)}
                />
              </div>

              <div className="pr-review-drawer-footer">
                <button
                  type="button"
                  className="chip"
                  disabled={(!reviewSummary.trim() && stagedComments.length === 0) || Boolean(pendingComment)}
                  onClick={() => void handleReviewAction()}
                >
                  <MessageSquareIcon size={12} /> {onSteerAgent ? "Use in thread" : "Copy notes"}
                </button>
                {onSteerAgent ? <button
                  type="button"
                  className="chip"
                  disabled={(!reviewSummary.trim() && stagedComments.length === 0) || Boolean(pendingComment)}
                  onClick={() => void handleReviewAction(true)}
                >
                  <CopyIcon size={12} /> Copy notes
                </button> : null}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
