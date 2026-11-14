import { useEffect, useMemo, useState } from "react";
import { DIFF_SCOPES, type Run, type RunHistoryCursor } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { reviewTurns, selectionValue, type ReviewSelection, type ReviewTurn } from "../../lib/review-scope";
import "./review.css";

const RUN_PAGE = 200;
const RUN_PAGES = 10;

/**
 * Every turn of the thread, not only the pages the conversation has loaded,
 * so "Turn N" counts from the thread's first turn.
 */
export function useReviewTurns(sessionId: string | undefined): { turns: ReviewTurn[]; loading: boolean } {
  const { api, runs } = useWorkspace();
  // A turn that has just saved its checkpoint is a new entry for the list.
  const signal = useMemo(() => (runs ?? []).filter((run) => run.sessionId === sessionId && run.checkpointRef).map((run) => run.id).join(","), [runs, sessionId]);
  const [state, setState] = useState<{ sessionId?: string; turns: ReviewTurn[]; loading: boolean }>({ turns: [], loading: false });
  useEffect(() => {
    if (!sessionId) { setState({ turns: [], loading: false }); return undefined; }
    let disposed = false;
    setState((current) => current.sessionId === sessionId ? { ...current, loading: true } : { sessionId, turns: [], loading: true });
    void (async () => {
      const all: Run[] = [];
      let before: RunHistoryCursor | undefined;
      for (let page = 0; page < RUN_PAGES; page += 1) {
        const result = await api.listRunPage({ sessionId, limit: RUN_PAGE, before });
        all.push(...result.runs);
        if (!result.hasMore || !result.before) break;
        before = result.before;
      }
      return all;
    })().then(
      (all) => { if (!disposed) setState({ sessionId, turns: reviewTurns(all), loading: false }); },
      () => { if (!disposed) setState((current) => ({ ...current, loading: false })); },
    );
    return () => { disposed = true; };
  }, [api, sessionId, signal]);
  return state.sessionId === sessionId ? state : { turns: [], loading: Boolean(sessionId) };
}

export function ReviewScopeBar({ selection, turns, loadingTurns, hasThread, onChoose, ignoreWhitespace, onIgnoreWhitespace }: {
  selection: ReviewSelection;
  turns: ReviewTurn[];
  loadingTurns: boolean;
  /** Turns belong to a conversation; without one only git's scopes are offered. */
  hasThread: boolean;
  onChoose: (value: string) => void;
  ignoreWhitespace: boolean;
  onIgnoreWhitespace: (value: boolean) => void;
}) {
  const selectedTurn = selection.kind === "turn" ? turns.find((turn) => turn.runId === selection.runId) : undefined;
  const value = selectionValue(selection);
  const scope = DIFF_SCOPES.find((item) => item.id === selection.kind);
  return <div className="review-scope-bar">
    <label className="review-scope-select">
      <span className="sr-only">Compare</span>
      <select className="field-select" value={value} onChange={(event) => onChoose(event.target.value)}
        title={selectedTurn?.label ?? scope?.detail}>
        {DIFF_SCOPES.filter((item) => item.id !== "turn").map((item) => <option key={item.id} value={item.id}>{GIT_LABEL[item.id]}</option>)}
        {selection.kind === "turn" && !selectedTurn ? <option value={value}>{loadingTurns ? "Loading turn…" : "No saved turns yet"}</option> : null}
        {turns.length ? (
          <optgroup label="Turns">
            {turns.map((turn) => <option key={turn.runId} value={`turn:${turn.runId}`}>{turn.label}</option>)}
          </optgroup>
        ) : selection.kind !== "turn" ? (
          <option value="" disabled>{!hasThread ? "Open a conversation to compare its turns" : loadingTurns ? "Loading turns…" : "No saved turns yet"}</option>
        ) : null}
      </select>
    </label>
    <button type="button" className={`chip review-ws-toggle${ignoreWhitespace ? " active" : ""}`} aria-pressed={ignoreWhitespace}
      title={ignoreWhitespace ? "Showing changes with whitespace ignored" : "Hide changes that only touch whitespace"}
      onClick={() => onIgnoreWhitespace(!ignoreWhitespace)}>
      Ignore whitespace
    </button>
  </div>;
}

const GIT_LABEL: Record<string, string> = {
  uncommitted: "Uncommitted changes",
  staged: "Staged changes",
  unstaged: "Unstaged changes",
  branch: "Branch changes",
};
