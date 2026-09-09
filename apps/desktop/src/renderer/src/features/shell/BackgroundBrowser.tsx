import { useEffect, useRef, useState } from "react";
import type { BackgroundBrowserCommand, BackgroundBrowserView } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";

/** Remote clients see only explicitly shared frames, never a browser-control API. */
export function BackgroundBrowser({ desktop, url, available, active, onControlChange }: {
  desktop: boolean;
  url: string;
  available: boolean;
  active: boolean;
  onControlChange?: () => void;
}) {
  const { api, session } = useWorkspace();
  const [expanded, setExpanded] = useState(!desktop);
  const [page, setPage] = useState<BackgroundBrowserView>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  const owner = session?.id;

  useEffect(() => {
    const epoch = ++generation.current;
    const read = desktop ? api.inspectBackgroundBrowser : api.readSharedBrowser;
    if (!owner || !expanded || !active || !read) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      if (disposed) return;
      if (!pending.current && document.visibilityState !== "hidden") {
        try {
          const result = await read(owner!);
          if (!disposed && epoch === generation.current) { setPage(result as BackgroundBrowserView); setError(undefined); }
        } catch (failure) {
          if (!disposed && epoch === generation.current) { setPage(undefined); setError(formatUserError(failure)); }
        }
      }
      if (!disposed) timer = setTimeout(() => void refresh(), 2000);
    }
    void refresh();
    return () => { disposed = true; generation.current++; clearTimeout(timer); };
  }, [api, owner, desktop, expanded, active, revision]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);

  async function control(command: BackgroundBrowserCommand) {
    if (!desktop || !owner || pending.current) return;
    generation.current++;
    pending.current = true; setBusy(true); setError(undefined);
    try {
      const result = await api.controlBackgroundBrowser(owner, command);
      if (mounted.current) { setPage(result as BackgroundBrowserView); onControlChange?.(); }
    } catch (failure) { if (mounted.current) setError(formatUserError(failure)); }
    finally {
      pending.current = false;
      if (mounted.current) { setBusy(false); setRevision((value) => value + 1); }
    }
  }

  const shared = page?.exists && (!desktop ? page.remoteShared : true);
  return <details className="background-browser" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>{desktop ? "Background page" : "Shared browser preview"}</summary>
    {!owner ? <p className="faint">Select a conversation first.</p> : <>
      <p className="faint">{desktop
        ? "A separate, temporary page keeps running when you leave this panel. It closes after 30 minutes or when Capsule quits. Sign-ins are not copied from the visible browser."
        : "Read-only snapshots of a page shared from the desktop. Navigation, typing and agent access stay under desktop control."}</p>
      {desktop && <div className="background-browser-actions">
        {page?.exists ? <button type="button" className="chip" disabled={busy} onClick={() => void control({ kind: "close" })}>Close page</button>
          : <button type="button" className="chip" disabled={busy || !url || !page} onClick={() => void control({ kind: "start", url })}>Start from address bar</button>}
        {page?.exists && <>
          <button type="button" className="chip" aria-pressed={page.agentAllowed === true} disabled={busy || (!available && !page.agentAllowed)} onClick={() => void control({ kind: "agent", allowed: !page.agentAllowed })}>
            {page.agentAllowed ? "Revoke background control" : "Allow background agent control"}
          </button>
          <button type="button" className="chip" aria-pressed={page.remoteShared === true} disabled={busy} onClick={() => void control({ kind: "share", allowed: !page.remoteShared })}>
            {page.remoteShared ? "Stop sharing preview" : "Share preview with paired viewers"}
          </button>
        </>}
      </div>}
      {desktop && page?.exists && <p className="faint">Agent control targets this background page instead of the visible page. Sharing exposes its URL and screenshots to paired viewers, including any sensitive page content.</p>}
      {desktop && page?.exists && !available && !page.agentAllowed && <p className="faint">Start a compatible direct agent in this thread before allowing background control.</p>}
      {busy && <p role="status">Updating background page…</p>}
      {error && <p role="alert">{error}</p>}
      {!page && !error && <p className="faint" role="status">Checking for a page…</p>}
      {page && !shared && <p className="faint">{desktop ? "No background page running." : "No page is shared with this viewer. Enable sharing in this conversation’s desktop Browser panel."}</p>}
      {shared && <>
        <p className="background-browser-url" title={page.url}>{page.url || "Loading page…"}</p>
        {page.error && <p role="alert">{page.error}</p>}
        {page.image && <img className="background-browser-image" src={page.image} alt="Read-only snapshot of the background page" />}
        <p className="faint">{page.capturedAt ? `Last checked ${new Date(page.capturedAt).toLocaleTimeString()}. ` : ""}
          {page.expiresAt ? `Closes at ${new Date(page.expiresAt).toLocaleTimeString()}.` : ""}</p>
      </>}
    </>}
  </details>;
}
