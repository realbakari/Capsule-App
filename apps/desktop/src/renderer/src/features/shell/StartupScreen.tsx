import { useEffect, useState } from "react";
import { formatUserError } from "../../lib/errors";

export function useAppClosing(startupError?: string): boolean {
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const dispose = window.capsule.on("state", (payload) => {
      if ((payload as { command?: string } | undefined)?.command === "app-shutting-down") setClosing(true);
    });
    return () => { dispose(); };
  }, []);
  // A renderer loading just as Quit begins may miss the event but receive the
  // rejection from its first workspace read. Neither case is retryable.
  return closing || (startupError !== undefined && formatUserError(startupError) === "Capsule is shutting down.");
}

export function StartupScreen({ error, closing, retry }: { error?: string; closing: boolean; retry: () => void }) {
  return <main className="workspace-startup">
    <section className="workspace-startup-card" aria-labelledby="workspace-startup-title">
      <span className="empty-thread-mark" aria-hidden />
      <h1 id="workspace-startup-title">{closing ? "Closing Capsule…" : error ? "Could not open your workspace" : "Opening your workspace…"}</h1>
      {closing ? <p role="status">Stopping owned agents and closing your workspace. Saved projects and conversations will be available when you reopen Capsule.</p>
        : error ? <>
          <p role="alert">{error}</p>
          <p className="muted">Your saved projects and conversations have not been reset.</p>
          <button className="chip" type="button" onClick={retry}>Retry</button>
        </> : <p role="status">Loading saved projects and conversations.</p>}
    </section>
  </main>;
}
