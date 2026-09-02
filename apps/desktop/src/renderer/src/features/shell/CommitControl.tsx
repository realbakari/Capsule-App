import { useEffect, useRef, useState } from "react";

import { useWorkspace } from "../../lib/workspace";
import { ChevronDownIcon, GitBranchIcon } from "./icons";

/*
 * Commit, push and open a pull request from the thread's own header.
 *
 * All three already existed, but only inside the inspector's changes tab —
 * so finishing a turn meant leaving the conversation to find them. The header
 * is where you are when the agent stops, and it already says which branch you
 * are on; this puts the next step beside that.
 */
export function CommitControl() {
  const { git, gitCommit, gitPush, gitCreatePullRequest } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    function onPointerDown(event: MouseEvent) {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!git?.isRepo) return null;

  const trimmed = message.trim();
  const ahead = git.ahead ?? 0;
  // A push with nothing to send is not an error worth making someone discover.
  const canPush = ahead > 0 || git.dirty;

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
        title={
          git.dirty
            ? `${git.changed} changed file${git.changed === 1 ? "" : "s"}`
            : ahead > 0
              ? `${ahead} commit${ahead === 1 ? "" : "s"} to push`
              : "Nothing to commit — the working tree is clean."
        }
      >
        <GitBranchIcon size={12} />
        <span>Commit</span>
        {git.dirty ? <span className="git-dirty-indicator">•</span> : null}
        <ChevronDownIcon size={12} />
      </button>
      {open && (
        <div className="topbar-dropdown-menu commit-menu">
          <input
            ref={field}
            className="commit-menu-message"
            placeholder="Commit message"
            value={message}
            disabled={!git.dirty || busy}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !trimmed || !git.dirty) return;
              event.preventDefault();
              void run(async () => {
                await gitCommit(trimmed);
                setMessage("");
              });
            }}
          />
          <button
            type="button"
            disabled={!git.dirty || !trimmed || busy}
            onClick={() =>
              void run(async () => {
                await gitCommit(trimmed);
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
                await gitCommit(trimmed);
                setMessage("");
                await gitPush();
                setOpen(false);
              })
            }
          >
            Commit and push
          </button>
          <button
            type="button"
            disabled={!canPush || busy}
            onClick={() =>
              void run(async () => {
                await gitPush();
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
                  await gitCreatePullRequest(trimmed ? { title: trimmed } : undefined);
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
        </div>
      )}
    </div>
  );
}
