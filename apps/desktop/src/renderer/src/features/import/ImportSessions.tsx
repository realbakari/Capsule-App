import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PRESET_HARNESSES, type ImportAgentId, type ImportListing, type ImportableSession } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useModalFocus } from "../../lib/modal-focus";
import { compactRelativeTime } from "../../lib/sidebar";
import { useWorkspace } from "../../lib/workspace";
import { AgentGlyph } from "../shell/AgentGlyph";
import "./import.css";

/*
 * Import from the agents' own histories. One provider owns the dialog and a
 * per-project listing, so the project menu and the command palette open the
 * same thing.
 */

interface ImportValue {
  /** Why importing is unavailable here, or undefined. */
  disabledReason?: string;
  openImport: (projectId: string) => void;
}

const ImportContext = createContext<ImportValue>({ openImport: () => undefined });

export function useImportSessions(): ImportValue {
  return useContext(ImportContext);
}

export function agentName(agent: ImportAgentId): string {
  return PRESET_HARNESSES.find((preset) => preset.id === agent)?.name ?? agent;
}

export function ImportSessionsProvider({ children }: { children: ReactNode }) {
  const { api } = useWorkspace();
  const [open, setOpen] = useState<string>();
  const [listings, setListings] = useState<Record<string, ImportListing | { error: string } | undefined>>({});
  const disabledReason = api.isDesktop === false ? "Importing reads this computer's agent history. Use the desktop app." : undefined;

  const load = useCallback((projectId: string) => {
    void api.listImportableSessions(projectId).then(
      (listing) => setListings((current) => ({ ...current, [projectId]: listing })),
      (reason: unknown) => setListings((current) => ({ ...current, [projectId]: { error: formatUserError(reason) } })),
    );
  }, [api]);

  const openImport = useCallback((projectId: string) => {
    if (disabledReason) return;
    load(projectId);
    setOpen(projectId);
  }, [disabledReason, load]);

  const value = useMemo(() => ({ disabledReason, openImport }), [disabledReason, openImport]);
  return (
    <ImportContext.Provider value={value}>
      {children}
      {open && <ImportDialog projectId={open} read={listings[open]} onReload={() => load(open)} onClose={() => setOpen(undefined)} />}
    </ImportContext.Provider>
  );
}

type Filter = "all" | ImportAgentId;

function ImportDialog({ projectId, read, onReload, onClose }: {
  projectId: string;
  /** The listing, a reason it could not be read, or undefined while reading. */
  read?: ImportListing | { error: string };
  onReload: () => void;
  onClose: () => void;
}) {
  const listing = read && "sessions" in read ? read : undefined;
  const readError = read && "error" in read ? read.error : undefined;
  const { api, projects, setProjectId, setView, refresh } = useWorkspace();
  const project = projects.find((item) => item.id === projectId);
  const dialog = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  useModalFocus(dialog, true, onClose, "[data-cancel]");
  useEffect(() => { setError(undefined); }, [filter]);

  const counts = useMemo(() => {
    const result: Partial<Record<ImportAgentId, number>> = {};
    for (const session of listing?.sessions ?? []) result[session.agent] = (result[session.agent] ?? 0) + 1;
    return result;
  }, [listing]);
  const shown = (listing?.sessions ?? []).filter((session) => filter === "all" || session.agent === filter);
  const continuation = shown[0] ?? listing?.sessions[0];
  const missing = (listing?.sources ?? []).filter((source) => !source.found).map((source) => agentName(source.agent));

  const open = (sessionId: string) => {
    setProjectId(projectId, sessionId);
    setView("chat");
    onClose();
  };

  const importOne = async (session: ImportableSession) => {
    if (session.importedAs) { open(session.importedAs); return; }
    const key = `${session.agent}:${session.nativeSessionId}`;
    setBusy(key);
    setError(undefined);
    try {
      const created = await api.importSession({ projectId, agent: session.agent, nativeSessionId: session.nativeSessionId });
      onReload();
      await refresh();
      open(created.id);
    } catch (reason) {
      setError(formatUserError(reason));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="palette-backdrop center" onClick={onClose}>
      <div className="dialog import-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="import-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <h3 id="import-title">Import sessions</h3>
        <p className="import-lede">Sessions Claude Code and Codex ran in {project?.name ?? "this project"}’s folder. Importing copies the prompts and final replies into a new conversation. The agent’s own files are only read.</p>
        {listing && listing.sessions.length > 0 && (
          <div className="import-filters" role="tablist" aria-label="Agent">
            {(["all", "claude", "codex"] as const).map((option) => (
              <button key={option} type="button" role="tab" aria-selected={filter === option} className={`chip${filter === option ? " active" : ""}`}
                disabled={option !== "all" && !counts[option]} onClick={() => setFilter(option)}>
                {option === "all" ? `All ${listing.sessions.length}` : `${agentName(option)} ${counts[option] ?? 0}`}
              </button>
            ))}
          </div>
        )}
        {continuation && (
          <p className={`import-continuation ${continuation.continuation}`}>
            {continuation.continuation === "resume"
              ? "Your next message resumes the agent’s own session, with everything it remembers."
              : `Imported threads open as history. Your next message starts a fresh agent session that is given the transcript as context. ${continuation.reason ?? ""}`}
          </p>
        )}
        <div className="import-list" role="list" aria-busy={!read}>
          {readError ? (
            <p className="import-empty" role="alert">Could not read agent history: {readError} <button type="button" className="ghost" onClick={onReload}>Retry</button></p>
          ) : !listing ? (
            <p className="import-empty">Reading agent history…</p>
          ) : shown.length === 0 ? (
            <p className="import-empty">No Claude Code or Codex sessions ran in this folder.</p>
          ) : shown.map((session) => {
            const key = `${session.agent}:${session.nativeSessionId}`;
            return (
              <div key={key} className="import-row" role="listitem">
                <AgentGlyph id={session.agent} name={agentName(session.agent)} size={16} />
                <div className="import-row-text">
                  <span className="import-row-title" title={session.title}>{session.title}</span>
                  <span className="import-row-meta">
                    {agentName(session.agent)} · {session.turnCount} {session.turnCount === 1 ? "turn" : "turns"} · {compactRelativeTime(session.lastActivity)}
                  </span>
                </div>
                <button type="button" className="chip" disabled={busy !== undefined} onClick={() => void importOne(session)}>
                  {busy === key ? "Importing…" : session.importedAs ? "Open" : "Import"}
                </button>
              </div>
            );
          })}
        </div>
        {missing.length > 0 && <p className="import-note">No {missing.join(" or ")} history on this computer.</p>}
        <p className="import-note">Other agents keep no documented history on disk, so their sessions cannot be imported.</p>
        {error && <p role="alert" className="import-error">{error}</p>}
        <div className="actions">
          <button className="ghost" data-cancel onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
