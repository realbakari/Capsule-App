import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BoardCard, WorkspaceMode } from "@capsule/shared";

import { useWorkspace } from "../../lib/workspace";
import { useModalFocus } from "../../lib/modal-focus";
import { formatUserError } from "../../lib/errors";
import { AgentGlyph } from "../shell/AgentGlyph";
import { MenuSelect } from "../shell/MenuSelect";
import { CheckIcon, XIcon } from "../shell/icons";

const DEFAULT_AGENT = "";

/** Write a card: its prompt, who runs it, where, and what it waits for. */
export function NewCardDialog({ projectId: initialProject, cards, onClose }: {
  projectId: string;
  cards: BoardCard[];
  onClose: () => void;
}) {
  const { api, projects, harnesses } = useWorkspace();
  const ref = useRef<HTMLFormElement>(null);
  useModalFocus(ref, true, onClose, "textarea");
  const [projectId, setProjectId] = useState(initialProject);
  const project = projects.find((item) => item.id === projectId);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState(DEFAULT_AGENT);
  // Parallel cards need their own checkouts; a project that chose otherwise keeps its choice.
  const [mode, setMode] = useState<WorkspaceMode>(project?.defaultWorkspaceMode ?? "worktree");
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [autoStart, setAutoStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const candidates = useMemo(() => cards.filter((card) => card.session.projectId === projectId), [cards, projectId]);
  const agentOptions = useMemo(() => [
    { id: DEFAULT_AGENT, label: "Project default" },
    ...harnesses.map((harness) => ({
      id: harness.id,
      label: harness.name,
      icon: <AgentGlyph id={harness.id} name={harness.name} size={13} />,
      ...(harness.readiness === "ready" ? {} : { detail: harness.detail }),
    })),
  ], [harnesses]);

  async function submit(start: boolean) {
    if (!prompt.trim() || !projectId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.createBoardCard({
        projectId,
        prompt,
        dependsOn,
        autoStart: dependsOn.length > 0 && autoStart,
        workspaceMode: mode,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(agentId ? { agentId } : {}),
        ...(start ? { start: true } : {}),
      });
      onClose();
    } catch (caught) {
      setError(formatUserError(caught));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="palette-backdrop center" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="new-card-title">
      <form
        ref={ref}
        className="dialog board-card-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); void submit(false); }}
      >
        <div className="dialog-header">
          <div>
            <h3 id="new-card-title">New card</h3>
            <p>A card is a conversation that starts with this prompt.</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close dialog"><XIcon size={14} /></button>
        </div>
        <label>
          <span>Title <small>optional</small></span>
          <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="From the prompt’s first line" />
        </label>
        <label>
          <span>Prompt</span>
          <textarea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What should the agent do?"
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(dependsOn.length === 0); } }} />
        </label>
        <div className="board-dialog-row">
          {projects.length > 1 && (
            <div className="board-dialog-field">
              <span>Project</span>
              <MenuSelect ariaLabel="Project" value={projectId} options={projects.map((item) => ({ id: item.id, label: item.name }))}
                onChange={(id) => { setProjectId(id); setDependsOn([]); setMode(projects.find((item) => item.id === id)?.defaultWorkspaceMode ?? "worktree"); }} />
            </div>
          )}
          <div className="board-dialog-field">
            <span>Agent</span>
            <MenuSelect ariaLabel="Agent" value={agentId} options={agentOptions} onChange={setAgentId} />
          </div>
          <div className="board-dialog-field">
            <span>Workspace</span>
            <div className="board-segmented" role="radiogroup" aria-label="Workspace">
              <button type="button" role="radio" aria-checked={mode === "worktree"} className={mode === "worktree" ? "active" : ""} onClick={() => setMode("worktree")}>Own worktree</button>
              <button type="button" role="radio" aria-checked={mode === "local"} className={mode === "local" ? "active" : ""} onClick={() => setMode("local")}>Project folder</button>
            </div>
          </div>
        </div>
        <fieldset className="board-dialog-depends">
          <legend>Depends on</legend>
          {candidates.length === 0 ? <p className="muted">No other cards in this project to wait for.</p> : (
            <div className="board-dialog-list">
              {candidates.map((card) => {
                const checked = dependsOn.includes(card.session.id);
                return (
                  <button key={card.session.id} type="button" role="checkbox" aria-checked={checked} className={checked ? "checked" : ""}
                    onClick={() => setDependsOn((current) => checked ? current.filter((id) => id !== card.session.id) : [...current, card.session.id])}>
                    <span className="board-menu-check">{checked ? <CheckIcon size={11} /> : null}</span>
                    <span>{card.session.title}</span>
                  </button>
                );
              })}
            </div>
          )}
          {dependsOn.length > 0 && (
            <label className="board-dialog-toggle">
              <input type="checkbox" checked={autoStart} onChange={(event) => setAutoStart(event.target.checked)} />
              <span>Start on its own when {dependsOn.length === 1 ? "that card is" : "those cards are"} marked done</span>
            </label>
          )}
        </fieldset>
        {error ? <p className="notice" role="alert">{error}</p> : null}
        <div className="actions">
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          {dependsOn.length === 0 ? (
            <>
              <button className="ghost" type="submit" disabled={!prompt.trim() || busy}>Save as draft</button>
              <button className="send" type="button" disabled={!prompt.trim() || busy} onClick={() => void submit(true)}>{busy ? "Starting…" : "Start now"}</button>
            </>
          ) : (
            <button className="send" type="submit" disabled={!prompt.trim() || busy}>{busy ? "Adding…" : "Add to queue"}</button>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
