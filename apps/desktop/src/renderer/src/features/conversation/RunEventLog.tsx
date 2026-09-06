import { useEffect, useRef, useState } from "react";
import type { RunEventCursor, RunEventPage } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";

/** Pages replace one another: opening an old run never mounts its entire history. */
export function RunEventLog({ runId, failed = false }: { runId: string; failed?: boolean }) {
  const { api, settings } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<RunEventPage>();
  const [cursors, setCursors] = useState<Array<RunEventCursor | undefined>>([undefined]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    if (!open) return;
    setLoading(true); setError(undefined); setPage(undefined);
    void api.listRunEventPage(runId, cursors.at(-1)).then((next) => {
      if (generation.current === version) setPage(next);
    }).catch((error) => {
      if (generation.current === version) setError(String(error));
    }).finally(() => { if (generation.current === version) setLoading(false); });
    return () => { generation.current++; };
  }, [api, runId, open, cursors, retry]);
  return <details className="advanced run-event-log" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{failed ? "What the agent reported" : "Run log"}</summary>
    {open && <>
      <p className="faint">Recorded events, one page at a time. Oversized diagnostic payloads are marked as truncated.</p>
      {loading && <p role="status">Loading events…</p>}
      {error && <p role="alert">{error} <button onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
      <div className="event-log">{page?.events.filter((event) => settings?.reasoningSummary !== "hidden" || !/think|reason|thought/.test(String(event.data?.streamKind ?? event.type))).map((event) => <div key={event.id}>
        <span className="event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
        <span className="event-kind">{event.type}</span>
        <span className="event-text">{event.message}{event.data?.payloadTruncated ? "\n[Diagnostic payload truncated]" : ""}</span>
      </div>)}</div>
      {page?.events.length === 0 && <p className="faint">No recorded events.</p>}
      <div className="run-log-pages">
        <button disabled={loading || cursors.length === 1} onClick={() => setCursors((values) => values.slice(0, -1))}>Newer events</button>
        <button disabled={loading || !page?.hasMore} onClick={() => setCursors((values) => [...values, page?.before])}>Older events</button>
      </div>
    </>}
  </details>;
}
