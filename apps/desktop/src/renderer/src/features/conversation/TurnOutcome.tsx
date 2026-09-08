import { useCallback, useEffect, useRef, useState } from "react";
import type { Run } from "@capsule/shared";
import type { TouchedFile } from "../../lib/activity";
import { loadTurnOutcome } from "../../lib/turn-outcomes";
import { useWorkspace } from "../../lib/workspace";
import { SavedTurnDiff } from "./SavedTurnDiff";
import { formatUserError } from "../../lib/errors";
import { ChangedFilesCard } from "./ChangedFilesCard";

/** This component lives inside its originating turn, not below the thread. */
export function TurnOutcome({ run, cwd }: { run: Run; cwd?: string }) {
  const { api, setConfirm, setNotice } = useWorkspace();
  const [loaded, setLoaded] = useState<{ key: string; files: TouchedFile[]; patch?: string; partial?: boolean; saved?: boolean; filesTruncated?: boolean }>();
  const [showDiff, setShowDiff] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>();
  const diffSection = useRef<HTMLElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const key = `${run.sessionId}:${run.id}:${run.checkpointRef ?? "events"}`;
  useEffect(() => { setShowDiff(false); setSelectedPath(undefined); }, [key]);
  useEffect(() => {
    let disposed = false;
    setError(undefined);
    const load = async () => {
      const outcome = await loadTurnOutcome(run, cwd, api);
      if (!disposed) setLoaded({ key, ...outcome });
    };
    void load().catch((error) => {
      // Unavailable evidence is not a reason to show another turn's files.
      if (!disposed) { setLoaded(undefined); setError(formatUserError(error)); }
    });
    return () => { disposed = true; };
  }, [api, key, run.id, run.checkpointRef, cwd, retry]);

  const outcome = loaded?.key === key ? loaded : undefined;
  const readPatch = useCallback((path: string) => api.turnDiff(run.id, { relative: path }), [api, run.id]);
  useEffect(() => {
    if (showDiff) {
      diffSection.current?.focus({ preventScroll: true });
      diffSection.current?.scrollIntoView({ block: "nearest" });
    }
  }, [showDiff, selectedPath]);
  if (error) return <div className="notice" role="alert">Could not load this turn’s changes. {error} <button type="button" className="chip" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>;
  if (!outcome?.files.length && !outcome?.partial) return null;
  const restore = () => setConfirm({
    title: "Restore this turn?",
    detail:
      "Files in the project folder go back to how they stood when this turn finished — which includes anything you changed before it, not only the agent's work. Anything changed since is discarded.",
    confirmLabel: "Restore",
    danger: true,
    onConfirm: async () => {
      setRestoring(true);
      try {
        const result = await api.restoreTurn(run.id);
        if (!result.ok) setNotice(result.detail);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally { setRestoring(false); }
    },
  });

  return (
    <div className="turn-outcome" data-run-id={run.id}>
      {outcome?.partial && <p className="faint">Recent file activity only; no complete saved diff is available. Earlier activity is in this turn’s Run log.</p>}
      {outcome?.filesTruncated && <p className="faint">Large change set. This list and its totals are limited; inspect the saved checkpoints in Git for all files.</p>}
      {outcome && outcome.files.length > 0 && <ChangedFilesCard
        key={key}
        files={outcome.files}
        patch={outcome.patch}
        loadPatch={outcome.saved ? readPatch : undefined}
        filesTruncated={outcome.filesTruncated}
        onOpenDiff={outcome.saved || outcome.patch ? (path) => { setSelectedPath(path); setShowDiff(path ? true : !showDiff); } : undefined}
        onRestore={run.checkpointRef ? restore : undefined}
        restoring={restoring}
      />}
      {showDiff && (outcome?.saved || outcome?.patch) && (
        <section ref={diffSection} tabIndex={-1} className="turn-saved-diff" aria-label="This turn's saved changes">
          <div className="turn-saved-diff-heading">
            <span>{selectedPath ? "This file’s saved changes" : "This turn’s changes"}</span>
            {selectedPath && <button type="button" className="ghost" onClick={() => setSelectedPath(undefined)}>All changed files</button>}
            <button type="button" className="ghost" onClick={() => setShowDiff(false)}>Hide diff</button>
          </div>
          <SavedTurnDiff runId={run.id} path={selectedPath} initialPatch={outcome?.patch || undefined} />
        </section>
      )}
    </div>
  );
}
