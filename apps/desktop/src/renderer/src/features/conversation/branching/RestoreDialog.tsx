import { useCallback, useEffect, useRef, useState } from "react";
import type { RestoreScope, Run, TurnDiffResult } from "@capsule/shared";
import { useModalFocus } from "../../../lib/modal-focus";
import { useWorkspace } from "../../../lib/workspace";
import { formatUserError } from "../../../lib/errors";
import { SavedTurnDiff } from "../SavedTurnDiff";

export interface RestoreTarget {
  run: Run;
  turnNumber: number;
  /** Turns after this one that a conversation restore would hide. */
  laterTurns: number;
  scope: RestoreScope;
}

const LABELS: Record<RestoreScope, string> = { files: "Files", conversation: "Conversation", both: "Both" };

/** Why a scope cannot apply to this turn, or undefined. */
function unavailable(target: RestoreTarget, scope: RestoreScope): string | undefined {
  if (scope !== "conversation" && !target.run.checkpointRef) return "This turn has no checkpoint, so its files cannot be restored.";
  if (scope !== "files" && target.laterTurns === 0) return "This is the latest turn; there is nothing after it to hide.";
  return undefined;
}

function describe(target: RestoreTarget, scope: RestoreScope): string {
  const later = target.laterTurns === 1 ? "the turn after it leaves" : `the ${target.laterTurns} turns after it leave`;
  if (scope === "files") return "The project folder goes back to how this turn left it, including anything you changed by hand since. Every message stays.";
  if (scope === "conversation") return `${later.charAt(0).toUpperCase()}${later.slice(1)} the conversation. Files stay as they are. The agent starts a fresh session that is given the turns you keep.`;
  return `The folder goes back to this turn and ${later} the conversation. The agent starts a fresh session that is given the turns you keep.`;
}

/** Choose what to restore, look at what it would change, then confirm. */
export function RestoreDialog({ target, onClose, onRestore }: {
  target: RestoreTarget;
  onClose: () => void;
  onRestore: (scope: RestoreScope) => Promise<{ ok: boolean; detail: string }>;
}) {
  const { api } = useWorkspace();
  const dialog = useRef<HTMLDivElement>(null);
  const firstAvailable = (["files", "conversation", "both"] as const).find((scope) => !unavailable(target, scope));
  const [scope, setScope] = useState<RestoreScope>(unavailable(target, target.scope) ? firstAvailable ?? target.scope : target.scope);
  const [compare, setCompare] = useState<{ state: "loading" } | { state: "loaded"; diff: TurnDiffResult } | { state: "error"; detail: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  useModalFocus(dialog, true, close, "[data-cancel]");

  const loadCompare = useCallback(() => {
    setCompare({ state: "loading" });
    api.compareCheckpoint(target.run.id).then(
      (diff) => setCompare({ state: "loaded", diff }),
      (reason) => setCompare({ state: "error", detail: formatUserError(reason) }),
    );
  }, [api, target.run.id]);
  useEffect(() => { setCompare(undefined); }, [target.run.id]);

  const blocked = unavailable(target, scope);
  const confirm = async () => {
    if (blocked) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await onRestore(scope);
      if (result.ok) onClose();
      else setError(result.detail);
    } catch (reason) {
      setError(formatUserError(reason));
    } finally {
      setBusy(false);
    }
  };

  const prompt = target.run.prompt.replace(/\s+/g, " ").trim();
  return (
    <div className="palette-backdrop center" onClick={close}>
      <div className="dialog restore-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="restore-title" aria-describedby="restore-prompt" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <h3 id="restore-title">Restore to turn {target.turnNumber}</h3>
        <p id="restore-prompt" className="restore-prompt" title={prompt}>{prompt || "This turn"}</p>
        <div className="restore-scopes" role="radiogroup" aria-label="What to restore">
          {(["files", "conversation", "both"] as const).map((option) => {
            const reason = unavailable(target, option);
            return (
              <label key={option} className={`restore-scope${scope === option ? " selected" : ""}${reason ? " unavailable" : ""}`}>
                <input type="radio" name="restore-scope" value={option} checked={scope === option} disabled={Boolean(reason) || busy} onChange={() => { setScope(option); setError(undefined); }} />
                <span className="restore-scope-text">
                  <span className="restore-scope-label">{LABELS[option]}</span>
                  <span className="restore-scope-detail">{reason ?? describe(target, option)}</span>
                </span>
              </label>
            );
          })}
        </div>
        {target.run.checkpointRef ? (
          <section className="restore-compare" aria-label="Compare with the folder now">
            <div className="restore-compare-head">
              <span>{compare?.state === "loaded" ? compareSummary(compare.diff) : "See what restoring the files would change."}</span>
              <button type="button" className="chip" disabled={compare?.state === "loading"} aria-expanded={compare?.state === "loaded"}
                onClick={() => (compare?.state === "loaded" ? setCompare(undefined) : loadCompare())}>
                {compare?.state === "loading" ? "Comparing…" : compare?.state === "loaded" ? "Hide comparison" : "Compare"}
              </button>
            </div>
            {compare?.state === "error" && <p role="alert" className="restore-error">{compare.detail} <button type="button" className="ghost" onClick={loadCompare}>Retry</button></p>}
            {compare?.state === "loaded" && compare.diff.files.length > 0 && (
              <div className="restore-compare-diff">
                <SavedTurnDiff runId={target.run.id} initialPatch={compare.diff.patch || undefined} />
              </div>
            )}
          </section>
        ) : null}
        <p className="restore-redo-note">You can redo this until you send another message in this conversation.</p>
        {error && <p role="alert" className="restore-error">{error}</p>}
        <div className="actions">
          <button className="ghost" data-cancel onClick={close} disabled={busy}>Cancel</button>
          <button className="danger" data-confirm disabled={Boolean(blocked) || busy} onClick={() => void confirm()}>
            {busy ? "Restoring…" : scope === "both" ? "Restore both" : `Restore ${scope}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function compareSummary(diff: TurnDiffResult): string {
  const count = diff.files.length;
  if (!count) return "The folder already matches this turn. Restoring the files changes nothing.";
  const added = diff.files.reduce((sum, file) => sum + (file.added ?? 0), 0);
  const removed = diff.files.reduce((sum, file) => sum + (file.removed ?? 0), 0);
  return `Restoring the files changes ${count}${diff.filesTruncated ? "+" : ""} file${count === 1 ? "" : "s"} (+${added} −${removed} lines).`;
}
