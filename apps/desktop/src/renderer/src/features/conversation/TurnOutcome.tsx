import { useEffect, useState } from "react";
import { parseUnifiedDiff, type Run } from "@capsule/shared";
import type { TouchedFile } from "../../lib/activity";
import { loadTurnOutcome } from "../../lib/turn-outcomes";
import { useWorkspace } from "../../lib/workspace";
import { FileDiff } from "../shell/FileDiff";
import { ChangedFilesCard } from "./ChangedFilesCard";

/** This component lives inside its originating turn, not below the thread. */
export function TurnOutcome({ run, cwd }: { run: Run; cwd?: string }) {
  const { api, setConfirm, setNotice } = useWorkspace();
  const [loaded, setLoaded] = useState<{ key: string; files: TouchedFile[]; patch?: string }>();
  const [showDiff, setShowDiff] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const key = `${run.sessionId}:${run.id}:${run.checkpointRef ?? "events"}`;
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const outcome = await loadTurnOutcome(run, cwd, api);
      if (!disposed) setLoaded({ key, ...outcome });
    };
    void load().catch(() => {
      // Unavailable evidence is not a reason to show another turn's files.
      if (!disposed) setLoaded(undefined);
    });
    return () => { disposed = true; };
  }, [api, key, run.id, run.checkpointRef, cwd]);

  const outcome = loaded?.key === key ? loaded : undefined;
  if (!outcome?.files.length) return null;
  const restore = () => setConfirm({
    title: "Restore this turn?",
    detail: "Files in the project folder go back to how this turn left them. Anything changed since — by the agent or by you — is discarded.",
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
      <ChangedFilesCard
        files={outcome.files}
        onOpenDiff={outcome.patch ? () => setShowDiff((value) => !value) : undefined}
        onRestore={run.checkpointRef ? restore : undefined}
        restoring={restoring}
      />
      {showDiff && outcome.patch && (
        <section className="turn-saved-diff" aria-label="This turn's saved changes">
          <div className="turn-saved-diff-heading">
            <span>This turn’s changes</span>
            <button type="button" className="ghost" onClick={() => setShowDiff(false)}>Hide diff</button>
          </div>
          {parseUnifiedDiff(outcome.patch).map((file) => <FileDiff key={file.path} file={file} split={false} />)}
        </section>
      )}
    </div>
  );
}
