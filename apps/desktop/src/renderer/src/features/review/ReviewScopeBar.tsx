import { useEffect, useMemo, useState } from "react";
import { DIFF_SCOPES, type ReviewTargets, type Run, type RunHistoryCursor } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { commitLabel, reviewTurns, selectionValue, type ReviewSelection, type ReviewTurn } from "../../lib/review-scope";
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

const NO_TARGETS: ReviewTargets = { bases: { local: [], remote: [] }, commits: [] };

/**
 * The refs Branch can measure from and the branch's own commits. Read only
 * while the folder is a repository; a change of HEAD or base reads again.
 */
export function useReviewTargets(projectId: string | undefined, sessionId: string | undefined, base: string | undefined, enabled: boolean): ReviewTargets & { loading: boolean } {
  const { api, git } = useWorkspace();
  const key = JSON.stringify([projectId, sessionId, base, git?.branch, git?.ahead, enabled]);
  const [state, setState] = useState<{ key: string; value: ReviewTargets; loading: boolean }>({ key: "", value: NO_TARGETS, loading: false });
  useEffect(() => {
    if (!projectId || !enabled || typeof api.gitReviewTargets !== "function") { setState({ key, value: NO_TARGETS, loading: false }); return undefined; }
    let current = true;
    setState((previous) => ({ key, value: previous.value, loading: true }));
    api.gitReviewTargets(projectId, sessionId, base).then(
      (value) => { if (current) setState({ key, value, loading: false }); },
      () => { if (current) setState({ key, value: NO_TARGETS, loading: false }); },
    );
    return () => { current = false; };
    // `key` carries the inputs that change what git answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  return { ...state.value, loading: state.key !== key || state.loading };
}

export function ReviewScopeBar({ selection, turns, loadingTurns, targets, onBase, hasThread, onChoose, ignoreWhitespace, onIgnoreWhitespace }: {
  selection: ReviewSelection;
  turns: ReviewTurn[];
  loadingTurns: boolean;
  /** Bases and commits for Branch and Commit; absent outside a repository. */
  targets?: ReviewTargets & { loading: boolean };
  /** Choose what Branch measures from; undefined goes back to the default branch. */
  onBase?: (base: string | undefined) => void;
  /** Turns belong to a conversation; without one only git's scopes are offered. */
  hasThread: boolean;
  onChoose: (value: string) => void;
  ignoreWhitespace: boolean;
  onIgnoreWhitespace: (value: boolean) => void;
}) {
  const selectedTurn = selection.kind === "turn" ? turns.find((turn) => turn.runId === selection.runId) : undefined;
  const commits = targets?.commits ?? [];
  const selectedCommit = selection.kind === "commit" ? commits.find((commit) => commit.oid === selection.oid) : undefined;
  const value = selectionValue(selection);
  const scope = DIFF_SCOPES.find((item) => item.id === selection.kind);
  const comparing = selection.kind === "branch" || selection.kind === "commit";
  const base = targets?.base;
  const bases = targets?.bases ?? NO_TARGETS.bases;
  return <div className="review-scope-bar">
    <label className="review-scope-select">
      <span className="sr-only">Compare</span>
      <select className="field-select" value={value} onChange={(event) => onChoose(event.target.value)}
        title={selectedTurn?.label ?? (selectedCommit ? `${selectedCommit.subject} · ${selectedCommit.author}` : scope?.detail)}>
        {DIFF_SCOPES.filter((item) => item.id !== "turn" && item.id !== "commit").map((item) => <option key={item.id} value={item.id}>{GIT_LABEL[item.id]}</option>)}
        {selection.kind === "commit" && !selectedCommit ? <option value={value}>{targets?.loading ? "Loading commits…" : "No commits on this branch"}</option> : null}
        {commits.length ? (
          <optgroup label={base ? `Commits since ${base}` : "Commits"}>
            {commits.map((commit) => <option key={commit.oid} value={`commit:${commit.oid}`}>{commitLabel(commit)}</option>)}
            {targets?.commitsTruncated ? <option value="" disabled>Older commits are not listed</option> : null}
          </optgroup>
        ) : null}
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
    {comparing && onBase ? (
      <label className="review-scope-select review-base-select">
        <span className="faint">against</span>
        <select className="field-select" value={base ?? ""} onChange={(event) => onBase(event.target.value || undefined)}
          title="What Branch measures from, and where the commit list starts">
          {!base ? <option value="">{targets?.loading ? "Loading…" : "No base found"}</option> : null}
          {bases.local.length ? <optgroup label="Local">{bases.local.map((name) => <option key={name} value={name}>{name}</option>)}</optgroup> : null}
          {bases.remote.length ? <optgroup label="Remote">{bases.remote.map((name) => <option key={name} value={name}>{name}</option>)}</optgroup> : null}
          {base && !bases.local.includes(base) && !bases.remote.includes(base) ? <option value={base}>{base}</option> : null}
        </select>
      </label>
    ) : null}
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
  commit: "Commit",
};
