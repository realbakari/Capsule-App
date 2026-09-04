import { useEffect, useRef, useState } from "react";

import { useWorkspace } from "../../lib/workspace";
import { ChevronDownIcon, GitBranchIcon } from "./icons";
import { HeaderPopover } from "./HeaderPopover";

/*
 * Commit, push and open a pull request from the thread's own header.
 *
 * All three already existed, but only inside the inspector's changes tab —
 * so finishing a turn meant leaving the conversation to find them. The header
 * is where you are when the agent stops, and it already says which branch you
 * are on; this puts the next step beside that.
 */
export function CommitControl() {
  const { git, gitCommit, gitPush, gitCreatePullRequest, project, session } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  // A message typed for one thread is not a message for the next one.
  useEffect(() => {
    setOpen(false);
    setMessage("");
  }, [project?.id, session?.id]);

  if (!git?.isRepo) return null;

  const trimmed = message.trim();
  const ahead = git.ahead ?? 0;
  // A push with nothing to send is not an error worth making someone discover.
  const canPush = ahead > 0;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="topbar-menu-anchor" ref={anchor}>
      <button
        type="button"
        className="topbar-chip-btn"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          git.dirty
            ? `${git.changed} changed file${git.changed === 1 ? "" : "s"}`
            : ahead > 0
              ? `${ahead} commit${ahead === 1 ? "" : "s"} to push`
              : "Nothing to commit — the working tree is clean."
        }
      >
        <GitBranchIcon size={12} />
        {/* No second dot: the branch chip beside this one already carries the
            one that says the tree is dirty. */}
        <span>Commit</span>
        <ChevronDownIcon size={12} />
      </button>
      {open && (
        <HeaderPopover anchor={anchor} label="Commit changes" className="commit-menu" onClose={() => setOpen(false)}>
          <input
            className="commit-menu-message"
            placeholder="Commit message"
            aria-label="Commit message"
            value={message}
            disabled={!git.dirty || busy}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !trimmed || !git.dirty || busy) return;
              event.preventDefault();
              void run(async () => {
                if (!await gitCommit(trimmed)) return;
                setMessage("");
                setOpen(false);
              });
            }}
          />
          <button
            type="button"
            disabled={!git.dirty || !trimmed || busy}
            onClick={() =>
              void run(async () => {
                if (!await gitCommit(trimmed)) return;
                setMessage("");
                setOpen(false);
              })
            }
          >
            Commit
          </button>
          <button
            type="button"
            disabled={!git.dirty || !trimmed || busy}
            onClick={() =>
              void run(async () => {
                if (!await gitCommit(trimmed)) return;
                setMessage("");
                if (!await gitPush()) return;
                setOpen(false);
              })
            }
          >
            Commit and push
          </button>
          <button
            type="button"
            disabled={!canPush || busy}
            title={canPush ? "Push committed changes" : "No outgoing commits. Commit changes before pushing."}
            onClick={() =>
              void run(async () => {
                if (!await gitPush()) return;
                setOpen(false);
              })
            }
          >
            Push{ahead > 0 ? ` (${ahead})` : ""}
          </button>
          {/* Only where `gh` can actually open one: the alternative is a
              button that exists to explain why it does not work. */}
          {git.ghAvailable && !git.pullRequest && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!await gitCreatePullRequest(trimmed ? { title: trimmed } : undefined)) return;
                  setMessage("");
                  setOpen(false);
                })
              }
            >
              Create pull request
            </button>
          )}
          {git.pullRequest && (
            <div className="commit-menu-note">
              Pull request #{git.pullRequest.number} is open.
            </div>
          )}
        </HeaderPopover>
      )}
    </div>
  );
}
