import type { HunkAction, HunkStage } from "@capsule/shared";
import "./review.css";

/** Where a hunk's controls stand: idle, waiting on git, or refused with git's reason. */
export type HunkProgress = { busy: HunkAction } | { error: string };

const LABEL: Record<HunkAction, string> = { keep: "Keep", unstage: "Unstage", reject: "Reject" };
const HINT: Record<HunkAction, string> = {
  keep: "Stage this change (K)",
  unstage: "Move this change back out of the index (U)",
  reject: "Revert this change in the working tree (X)",
};
const ORDER: HunkAction[] = ["keep", "unstage", "reject"];
const STAGE_LABEL: Record<Exclude<HunkStage, "unstaged">, string> = { staged: "Staged", partly: "Partly staged" };

export function HunkTools({ actions, stage, progress, scopeLabel, onAct, onRetry }: {
  actions: readonly HunkAction[];
  stage?: HunkStage;
  progress?: HunkProgress;
  /** "all" for the file-wide row: its buttons read "Keep all" and so on. */
  scopeLabel?: "all";
  onAct: (action: HunkAction) => void;
  onRetry?: () => void;
}) {
  const busy = progress && "busy" in progress ? progress.busy : undefined;
  return (
    <>
      <span className="hunk-tools">
        {stage && stage !== "unstaged" ? <span className={`hunk-stage hunk-stage--${stage}`}>{STAGE_LABEL[stage]}</span> : null}
        {ORDER.filter((action) => actions.includes(action)).map((action) => (
          <button
            key={action}
            type="button"
            className={`hunk-action hunk-action--${action}`}
            title={scopeLabel ? undefined : HINT[action]}
            disabled={Boolean(busy)}
            aria-busy={busy === action || undefined}
            onClick={(event) => { event.stopPropagation(); onAct(action); }}
          >
            {busy === action ? `${LABEL[action]}…` : scopeLabel ? `${LABEL[action]} all` : LABEL[action]}
          </button>
        ))}
      </span>
      {progress && "error" in progress ? (
        <p className="hunk-error" role="alert">
          <span>{progress.error}</span>
          {onRetry ? <button type="button" className="hunk-action" onClick={(event) => { event.stopPropagation(); onRetry(); }}>Reload diff</button> : null}
        </p>
      ) : null}
    </>
  );
}
