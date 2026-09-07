import { useRef, useState } from "react";
import { formatUserError } from "../../lib/errors";

/** Keep a failed commit recoverable. Mount with a workspace key so drafts never cross folders. */
export function ReviewCommitForm({ dirty, onCommit }: {
  dirty: boolean;
  onCommit: (message: string) => Promise<boolean>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const reason = !dirty ? "The working tree is clean." : !message.trim() ? "Write a commit message first." : undefined;

  async function commit() {
    if (!dirty || !message.trim() || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (await onCommit(message.trim())) setMessage("");
      else setError("Commit did not complete. Your message has been kept.");
    } catch (failure) {
      setError(formatUserError(failure));
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
      <input type="text" aria-label="Commit message" placeholder="Commit message"
        value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} />
      <button className="review-commit-button" type="submit" disabled={Boolean(reason) || busy} title={reason}>
        {busy ? "Committing…" : "Commit"}
      </button>
    </form>
    {error ? <p className="review-commit-note" role="alert">{error}</p>
      : !dirty ? <p className="review-commit-note">{reason}</p> : null}
  </div>;
}
