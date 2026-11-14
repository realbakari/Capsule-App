import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { HarnessId } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { harnessReadinessLabel } from "../../lib/harness";
import { useModalFocus } from "../../lib/modal-focus";
import { useWorkspace } from "../../lib/workspace";
import { AgentGlyph } from "../shell/AgentGlyph";
import { MenuSelect } from "../shell/MenuSelect";
import "./handoff.css";

/*
 * Continue in a new thread. One provider owns the dialog so the context ring,
 * the thread menu and the palette open the same thing.
 */

interface HandoffValue {
  /** Why handing off is unavailable here, or undefined. */
  disabledReason?: string;
  openHandoff: (sessionId: string) => void;
}

const HandoffContext = createContext<HandoffValue>({ openHandoff: () => undefined });

export function useHandoff(): HandoffValue {
  return useContext(HandoffContext);
}

export const HANDOFF_LABEL = "Continue in a new thread…";

export function HandoffProvider({ children }: { children: ReactNode }) {
  const { api } = useWorkspace();
  const [open, setOpen] = useState<string>();
  const disabledReason = api.isDesktop === false ? "Starting a thread is available in the desktop app." : undefined;
  const openHandoff = useCallback((sessionId: string) => { if (!disabledReason) setOpen(sessionId); }, [disabledReason]);
  const value = useMemo(() => ({ disabledReason, openHandoff }), [disabledReason, openHandoff]);
  return (
    <HandoffContext.Provider value={value}>
      {children}
      {open && <HandoffDialog sessionId={open} onClose={() => setOpen(undefined)} />}
    </HandoffContext.Provider>
  );
}

function HandoffDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { api, sessions, harnesses, setProjectId, setView, refresh } = useWorkspace();
  const source = sessions.find((item) => item.id === sessionId);
  const dialog = useRef<HTMLDivElement>(null);
  const [agent, setAgent] = useState<string>(source?.harnessId ?? harnesses.find((item) => item.readiness === "ready")?.id ?? "claude");
  const [summary, setSummary] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  useModalFocus(dialog, true, close, "textarea");

  const load = useCallback(() => {
    setLoadError(undefined);
    api.handoffDraft(sessionId).then((draft) => setSummary(draft.summary), (reason) => setLoadError(formatUserError(reason)));
  }, [api, sessionId]);
  useEffect(load, [load]);

  const options = harnesses.map((harness) => ({
    id: harness.id,
    label: harness.name,
    icon: <AgentGlyph id={harness.id} name={harness.name} size={14} />,
    detail: harness.id === source?.harnessId ? "This thread’s agent" : harnessReadinessLabel(harness.readiness),
  }));

  const start = async () => {
    if (!summary?.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.handoffSession({ sessionId, harnessId: agent as HarnessId, summary });
      await refresh();
      setProjectId(created.projectId, created.id);
      setView("chat");
      onClose();
    } catch (reason) {
      setError(formatUserError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="palette-backdrop center" onClick={close}>
      <div className="dialog handoff-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="handoff-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <h3 id="handoff-title">Continue in a new thread</h3>
        <p className="handoff-lede">The new thread starts with a clean context. The summary goes with your first message there, once. This thread stays as it is.</p>
        <div className="handoff-field">
          <span className="handoff-label">Agent</span>
          <MenuSelect value={agent} options={options} onChange={setAgent} ariaLabel="Agent for the new thread" />
        </div>
        <label className="handoff-field">
          <span className="handoff-label">Summary</span>
          {loadError ? (
            <span role="alert" className="handoff-error">{loadError} <button type="button" className="ghost" onClick={load}>Retry</button></span>
          ) : (
            <textarea className="handoff-summary" value={summary ?? ""} placeholder={summary === undefined ? "Building a summary from this thread…" : "What the next thread should know"}
              disabled={summary === undefined || busy} onChange={(event) => setSummary(event.target.value)} spellCheck={false} />
          )}
          <span className="handoff-hint">Built from this thread’s prompts and final replies, newest kept. Cut it down to what matters.</span>
        </label>
        {error && <p role="alert" className="handoff-error">{error}</p>}
        <div className="actions">
          <button className="ghost" data-cancel onClick={close} disabled={busy}>Cancel</button>
          <button className="send" disabled={busy || !summary?.trim()} onClick={() => void start()}>{busy ? "Starting…" : "Start new thread"}</button>
        </div>
      </div>
    </div>
  );
}
