import { useEffect, useRef, useState } from "react";
import type { GitChange, GitCommitScope, GitStatus } from "@capsule/shared";

import { useWorkspace } from "../../lib/workspace";
import { commitPlan, plural, pushBlocked, syncState, type SyncState } from "../../lib/git-plan";
import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, CloudUploadIcon, GitCommitIcon, GitPullRequestIcon } from "./icons";
import { HeaderPopover } from "./HeaderPopover";
import { useGitActions, type GitRunner } from "./use-git-actions";

/*
 * Commit, push, pull and open a pull request from the thread's own header.
 *
 * The header is where you are when the agent stops, and it already says
 * which branch you are on; this puts the next step beside that. A commit
 * takes what Review staged, or the files ticked here when nothing is.
 */
export function CommitControl({ startOpen = false }: { startOpen?: boolean }) {
  const { git, gitCommit, gitPull, gitFetch, notice, project, session } = useWorkspace();
  const actions = useGitActions();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string>();
  const [failed, setFailed] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  // A message typed for one thread is not a message for the next one.
  useEffect(() => {
    setOpen(false);
    setMessage("");
    setExcluded(new Set());
    setFailed(false);
  }, [project?.id, session?.id]);

  // Opened from the palette; after mount, so the details popover around it has settled its focus.
  useEffect(() => {
    if (startOpen) setOpen(true);
  }, [startOpen]);

  // Ahead and behind are only as fresh as the last fetch.
  useEffect(() => {
    if (open) void gitFetch();
  }, [open, gitFetch]);

  if (!git?.isRepo) return null;

  const plan = commitPlan(git.files);
  const sync = syncState(git);
  const files = plan.kind === "choose" ? [...plan.tracked, ...plan.untracked] : [];
  const chosen = files.map((file) => file.path).filter((item) => !excluded.has(item));
  const scope: GitCommitScope | undefined = plan.kind === "staged" ? { staged: true } : chosen.length ? { paths: chosen } : undefined;
  const text = message.trim();
  const ready = Boolean(scope && text) && !busy;
  const hooks = git.hooks ?? [];
  const commitHooks = hooks.some((hook) => hook !== "pre-push");
  const pushHook = hooks.includes("pre-push");
  const blocked = pushBlocked(sync);
  const commitLabel = plan.kind === "staged" ? `Commit ${plural(plan.count, "staged file")}` : `Commit ${plural(chosen.length, "file")}`;

  const runner = (label: string, after: () => void): GitRunner => async (work) => {
    setBusy(label);
    setFailed(false);
    try {
      const ok = await work();
      if (ok) after();
      else setFailed(true);
      return ok;
    } finally {
      setBusy(undefined);
    }
  };
  const close = () => setOpen(false);
  const finished = () => {
    setMessage("");
    setExcluded(new Set());
    setOpen(false);
  };
  const commit = () => {
    if (!ready || !scope) return;
    void runner(commitHooks ? "Running commit hooks…" : "Committing…", finished)(() => gitCommit(text, scope));
  };
  const toggle = (item: string) => setExcluded((current) => {
    const next = new Set(current);
    if (!next.delete(item)) next.add(item);
    return next;
  });

  return (
    <div className="session-details-anchor" ref={anchor}>
      <button
        type="button"
        className="session-details-action"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={triggerTitle(git, sync)}
      >
        {sync.kind === "behind" && !git.dirty ? <ArrowDownIcon size={14} /> : <CloudUploadIcon size={14} />}
        <span>{triggerLabel(git, sync)}</span>
        <ChevronDownIcon size={12} />
      </button>
      {open && (
        <HeaderPopover anchor={anchor} label="Commit changes" className="commit-menu" onClose={() => setOpen(false)}>
          <textarea
            className="commit-menu-message"
            placeholder="Commit message"
            aria-label="Commit message"
            title="The first line is the subject. ⌘Return commits."
            rows={2}
            value={message}
            disabled={plan.kind === "clean" || Boolean(busy)}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
              event.preventDefault();
              commit();
            }}
          />
          {plan.kind === "staged" && plan.count < git.files.length ? (
            <p className="commit-menu-note">Only staged changes are committed. The rest stay in the working tree.</p>
          ) : null}
          {plan.kind === "choose" ? (
            <div className="commit-menu-files" aria-label="Files to commit" role="group">
              <div className="commit-menu-files-head">
                <span>{chosen.length} of {plural(files.length, "file")}</span>
                <button type="button" disabled={Boolean(busy)}
                  onClick={() => setExcluded(chosen.length ? new Set(files.map((file) => file.path)) : new Set())}>
                  {chosen.length ? "Select none" : "Select all"}
                </button>
              </div>
              <FileChecks heading="Changes" files={plan.tracked} excluded={excluded} disabled={Boolean(busy)} onToggle={toggle} />
              <FileChecks heading="Untracked" files={plan.untracked} excluded={excluded} disabled={Boolean(busy)} onToggle={toggle} />
            </div>
          ) : null}
          <button type="button" disabled={!ready} onClick={commit}>
            <GitCommitIcon size={14} />
            {commitLabel}
          </button>
          <button
            type="button"
            disabled={!ready || sync.kind === "behind" || sync.kind === "diverged" || sync.kind === "no-remote" || sync.kind === "detached"}
            title={sync.kind === "behind" || sync.kind === "diverged" ? blocked : undefined}
            onClick={() => scope && void actions.commitAndPush(text, scope, runner(commitHooks || pushHook ? "Running hooks, then pushing…" : "Committing and pushing…", finished))}
          >
            <CloudUploadIcon size={14} />
            {sync.kind === "publish" ? "Commit and publish" : "Commit and push"}
          </button>
          {sync.kind === "behind" ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => void runner("Pulling…", close)(() => gitPull("ff-only"))}>
              <ArrowDownIcon size={14} />
              Pull {plural(sync.behind, "commit")}
            </button>
          ) : null}
          {sync.kind === "diverged" ? (
            <>
              <p className="commit-menu-note">
                {git.branch} and {sync.upstream} have both changed: {sync.ahead} ahead, {sync.behind} behind.
              </p>
              <button type="button" disabled={Boolean(busy)} onClick={() => void runner("Rebasing…", close)(() => gitPull("rebase"))}>
                <ArrowDownIcon size={14} />
                Rebase onto {sync.upstream}
              </button>
            </>
          ) : null}
          <button
            type="button"
            disabled={Boolean(blocked) || Boolean(busy)}
            title={blocked ?? (sync.kind === "publish" ? `Push this branch to ${sync.remote} for the first time` : "Push committed changes")}
            onClick={() => void actions.push(runner(pushHook ? "Running the pre-push hook…" : "Pushing…", close))}
          >
            <ArrowUpIcon size={14} />
            {sync.kind === "publish" ? "Publish branch" : `Push${sync.kind === "ahead" ? ` ${plural(sync.ahead, "commit")}` : ""}`}
          </button>
          {blocked && sync.kind !== "synced" ? <p className="commit-menu-note">{blocked}</p> : null}
          {/* Only where `gh` can actually open one: the alternative is a
              button that exists to explain why it does not work. */}
          {git.ghAvailable && !git.pullRequest && (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void actions.createPullRequest(text || undefined, runner("Opening pull request…", finished))}
            >
              <GitPullRequestIcon size={14} />
              Create pull request
            </button>
          )}
          {git.pullRequest && (
            <div className="commit-menu-note">
              Pull request #{git.pullRequest.number} is open.
            </div>
          )}
          {busy ? <p className="commit-menu-status" role="status">{busy}</p> : null}
          {failed && !busy && notice ? <p className="commit-menu-error" role="alert">{notice}</p> : null}
        </HeaderPopover>
      )}
    </div>
  );
}

function FileChecks({ heading, files, excluded, disabled, onToggle }: {
  heading: string;
  files: readonly GitChange[];
  excluded: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (path: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <>
      <h5>{heading}</h5>
      {files.map((file) => (
        <label key={file.path} className="commit-menu-file" title={file.path}>
          <input type="checkbox" checked={!excluded.has(file.path)} disabled={disabled} onChange={() => onToggle(file.path)} />
          <span className="mono">{file.path}</span>
        </label>
      ))}
    </>
  );
}

function triggerLabel(git: GitStatus, sync: SyncState): string {
  if (git.dirty) return "Commit & push";
  switch (sync.kind) {
    case "behind": return `Pull ${plural(sync.behind, "commit")}`;
    case "ahead": return `Push ${plural(sync.ahead, "commit")}`;
    case "diverged": return "Pull & push";
    case "publish": return "Publish branch";
    default: return "Commit & push";
  }
}

function triggerTitle(git: GitStatus, sync: SyncState): string {
  if (git.dirty) return plural(git.changed, "changed file");
  switch (sync.kind) {
    case "behind": return `${sync.upstream} has ${plural(sync.behind, "commit")} to pull`;
    case "ahead": return `${plural(sync.ahead, "commit")} to push`;
    case "diverged": return `${sync.ahead} ahead of ${sync.upstream}, ${sync.behind} behind`;
    case "publish": return `This branch is not on ${sync.remote} yet`;
    default: return "Nothing to commit. The working tree is clean.";
  }
}
