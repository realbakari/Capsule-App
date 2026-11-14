import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GitPullRequest, PullRequestCheckoutTarget } from "@capsule/shared";
import { useModalFocus } from "../../lib/modal-focus";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { useToasts } from "../../lib/toasts";
import "./worktree-base.css";

const TARGETS: Array<{ id: PullRequestCheckoutTarget; label: string; detail: string }> = [
  { id: "worktree", label: "New worktree", detail: "A separate branch and folder. The project folder stays as it is." },
  { id: "local", label: "Project folder", detail: "Switches the project folder to the pull request. Needs no uncommitted changes." },
];

/** Choose where a pull request is checked out, then open a thread on it. */
export function PullRequestCheckoutDialog({ pullRequest, onClose }: { pullRequest: GitPullRequest; onClose: () => void }) {
  const { startPullRequestThread } = useWorkspace();
  const { show } = useToasts();
  const dialog = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<PullRequestCheckoutTarget>("worktree");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => { if (!busy) onClose(); };
  useModalFocus(dialog, true, close, "[data-confirm]");

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      const { detail } = await startPullRequestThread({
        number: pullRequest.number,
        title: pullRequest.title,
        url: pullRequest.url,
        ...(pullRequest.headRefName ? { headRefName: pullRequest.headRefName } : {}),
        target,
      });
      show({ key: `pr-checkout-${pullRequest.number}`, tone: "success", title: `Working on #${pullRequest.number}`, detail });
      onClose();
    } catch (failure) {
      setError(formatUserError(failure));
      setBusy(false);
    }
  }

  return createPortal(
    <div className="palette-backdrop center" onClick={close}>
      <div className="dialog pr-checkout-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="pr-checkout-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <h3 id="pr-checkout-title">Work on #{pullRequest.number}</h3>
        <p className="pr-checkout-title">{pullRequest.title}</p>
        <fieldset className="pr-checkout-targets" disabled={busy}>
          <legend>Check it out in</legend>
          {TARGETS.map((item) => (
            <label key={item.id} className={target === item.id ? "active" : ""}>
              <input type="radio" name="pr-checkout-target" value={item.id} checked={target === item.id} onChange={() => setTarget(item.id)} />
              <span>
                <b>{item.label}</b>
                <small>{item.detail}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="pr-checkout-note">
          Fetches the pull request from origin. The new thread opens with a draft that links it.
        </p>
        {error ? <p className="notice" role="alert">{error}</p> : null}
        <div className="actions">
          <button className="ghost" type="button" disabled={busy} onClick={close}>Cancel</button>
          <button className="send" type="button" data-confirm disabled={busy} onClick={() => void start()}>
            {busy ? `Fetching #${pullRequest.number}…` : "Start thread"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
