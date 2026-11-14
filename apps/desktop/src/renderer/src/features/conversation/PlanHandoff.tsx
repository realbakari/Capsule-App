import { useWorkspace } from "../../lib/workspace";
import { latestPlanRun } from "../../lib/turn-mode";

/** Act on, or keep refining, the plan the latest turn produced. */
export function PlanHandoff({ compact = false }: { compact?: boolean }) {
  const { runs, session, activeRun, busy, api, actOnPlan, keepPlanning, sendBlockReason } = useWorkspace();
  const plan = latestPlanRun(runs, session?.id);
  if (!plan || activeRun) return null;
  /* A read-only viewer sees the plan, not controls it cannot use. */
  if (api.isDesktop === false && api.remoteMode !== "control") return null;
  return (
    <div className={`plan-handoff${compact ? " plan-handoff--compact" : ""}`} role="group" aria-label="Plan ready">
      {!compact && <span className="plan-handoff-label">Plan ready</span>}
      <button type="button" className="chip plan-handoff-act" disabled={busy || Boolean(sendBlockReason)}
        title={sendBlockReason ?? "Switch to Act and ask the agent to implement this plan"} onClick={() => void actOnPlan()}>
        Act on this plan
      </button>
      <button type="button" className="ghost plan-handoff-keep" disabled={busy}
        title="Stay in Plan and write what to change" onClick={() => void keepPlanning()}>
        Keep planning
      </button>
    </div>
  );
}
