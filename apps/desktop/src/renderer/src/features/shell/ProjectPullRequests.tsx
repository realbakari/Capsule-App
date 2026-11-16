import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GitPullRequest } from "@capsule/shared";
import { useAnchoredPopover } from "../../lib/anchored-popover";
import { requestReviewPullRequest } from "../../lib/review-commands";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { GitPullRequestIcon } from "./icons";

/*
 * Lists read this session, by project. Opening a list asks GitHub (behind the
 * main process's own short cache); the count on the row shows only once a
 * list is known, so the sidebar never asks GitHub about every project at once.
 */
const known = new Map<string, GitPullRequest[]>();

function status(pullRequest: GitPullRequest): { label: string; tone: string } {
  if (pullRequest.isDraft) return { label: "Draft", tone: "draft" };
  if (pullRequest.reviewDecision === "CHANGES_REQUESTED") return { label: "Changes requested", tone: "changes" };
  if (pullRequest.reviewDecision === "APPROVED") return { label: "Approved", tone: "ready" };
  return { label: "Ready", tone: "ready" };
}

/** A project's open pull requests, from its sidebar row. */
export function ProjectPullRequests({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { api, setProjectId, setView, setInspectorTab, setInspectorOpen } = useWorkspace();
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GitPullRequest[] | undefined>(() => known.get(projectId));
  const [error, setError] = useState<string>();
  const position = useAnchoredPopover(open, anchor, panel, "start");

  useEffect(() => {
    if (!open) return;
    let current = true;
    setError(undefined);
    void api.listPullRequests(projectId).then((result: { items?: GitPullRequest[]; error?: string }) => {
      if (!current) return;
      if (result.items) { known.set(projectId, result.items); setItems(result.items); }
      if (result.error) setError(result.error);
    }, (failure: unknown) => { if (current) setError(formatUserError(failure)); });
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      anchor.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { current = false; document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [api, open, projectId]);

  const show = (pullRequest: GitPullRequest) => {
    setOpen(false);
    setProjectId(projectId);
    setView("chat");
    setInspectorTab("changes");
    setInspectorOpen(true);
    requestReviewPullRequest({ projectId, pullRequest });
  };

  const count = items?.length ?? 0;
  return <>
    <button
      ref={anchor}
      type="button"
      className={`thread-more project-pulls${count ? " has-count" : ""}`}
      aria-label={count ? `${count} open pull requests in ${projectName}` : `Open pull requests in ${projectName}`}
      title={count ? `${count} open pull requests` : "Open pull requests"}
      aria-haspopup="dialog"
      aria-expanded={open}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
    >
      <GitPullRequestIcon size={13} />
      {count ? <span className="project-pulls-count">{count}</span> : null}
    </button>
    {open && createPortal(
      <div ref={panel} className="project-pulls-popover" style={position} role="dialog" aria-label={`Open pull requests in ${projectName}`}>
        {!items && !error ? <p className="project-pulls-note">Loading pull requests…</p> : null}
        {error ? <p className="project-pulls-note">{error}</p> : null}
        {items && items.length === 0 && !error ? <p className="project-pulls-note">No open pull requests.</p> : null}
        {items?.map((pullRequest) => {
          const state = status(pullRequest);
          return (
            <button key={pullRequest.number} type="button" className="project-pulls-row" onClick={() => show(pullRequest)}>
              <span className="project-pulls-title">{pullRequest.title}</span>
              <span className="project-pulls-meta">
                <span className={`project-pulls-state is-${state.tone}`}><GitPullRequestIcon size={12} />{state.label}</span>
                <span aria-hidden>·</span>
                <span>#{pullRequest.number}</span>
                {pullRequest.checks === "failure" ? <><span aria-hidden>·</span><span className="project-pulls-failing">Checks failing</span></> : null}
              </span>
            </button>
          );
        })}
      </div>,
      document.body,
    )}
  </>;
}
