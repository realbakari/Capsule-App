import { useRef, useState } from "react";
import type { GitChange, GitCommitScope } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { commitPlan, plural } from "../../lib/git-plan";

/**
 * Keep a failed commit recoverable. Mount with a workspace key so drafts never cross folders.
 *
 * What is staged is what commits. With nothing staged, the files listed
 * above are the checklist: Commit takes all of them, and says so.
 */
export function ReviewCommitForm({ files, onCommit, failure }: {
  files: readonly GitChange[];
  onCommit: (message: string, scope: GitCommitScope) => Promise<boolean>;
  /** Why the last git action failed, shown after this form's own commit fails. */
  failure?: string;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const plan = commitPlan(files);
  const scope: GitCommitScope | undefined = plan.kind === "staged" ? { staged: true }
    : plan.kind === "choose" ? { paths: files.map((file) => file.path) } : undefined;
  const reason = !scope ? "The working tree is clean." : !message.trim() ? "Write a commit message first." : undefined;
  const label = plan.kind === "staged" ? `Commit ${plan.count} staged` : plan.kind === "choose" ? `Commit all ${files.length}` : "Commit";

  async function commit() {
    if (!scope || !message.trim() || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (await onCommit(message.trim(), scope)) setMessage("");
      else setError(failure ? `${failure}\nYour message has been kept.` : "Commit did not complete. Your message has been kept.");
    } catch (thrown) {
      setError(formatUserError(thrown));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <div className="review-commit">
    <form className="commit-form" aria-label="Commit changes" aria-busy={busy} onSubmit={(event) => {
      event.preventDefault();
      void commit();
    }}>
      <textarea className="field" aria-label="Commit message" placeholder="Commit message" rows={1} title="The first line is the subject. ⌘Return commits."
        value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
          event.preventDefault();
          void commit();
        }} />
      <button className="review-commit-button" type="submit" disabled={Boolean(reason) || busy}
        title={reason ?? (plan.kind === "staged" ? `Commits ${plural(plan.count, "staged file")}; unstaged changes stay out.` : `Nothing is staged, so this commits all ${plural(files.length, "changed file")}. Stage files to commit only those.`)}>
        {busy ? "Committing…" : label}
      </button>
    </form>
    {error ? <p className="review-commit-note" role="alert">{error}</p>
      : !scope ? <p className="review-commit-note">{reason}</p>
        : plan.kind === "choose" && files.length > 1 ? <p className="review-commit-note">Nothing is staged, so this commits every changed file. Stage files above to commit only those.</p>
          : null}
  </div>;
}
