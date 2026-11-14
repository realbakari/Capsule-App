import type { PlanModeSupport, TurnMode } from "@capsule/shared";
import { ListTodoIcon } from "../shell/icons";

/**
 * Plan or Act for the next turn. The tooltip says who enforces a plan turn:
 * the agent, a read-only sandbox, or only Capsule's request.
 */
export function TurnModeChip({ mode, support, onToggle, disabledReason }: {
  mode: TurnMode;
  support: PlanModeSupport;
  onToggle: () => void;
  disabledReason?: string;
}) {
  const plan = mode === "plan";
  const title = disabledReason ?? (plan
    ? `Plan: ${support.label}. ${support.detail} (⇧Tab)`
    : "Act: the agent can change files with this conversation's permissions. Switch to Plan to get a plan first (⇧Tab)");
  return (
    <button type="button" className={`turn-mode-chip${plan ? " is-plan" : ""}${plan && !support.enforced ? " is-asked" : ""}`}
      aria-label="Plan mode" aria-pressed={plan} aria-description={plan ? support.label : undefined}
      aria-disabled={disabledReason ? true : undefined} title={title}
      onClick={() => { if (!disabledReason) onToggle(); }}>
      <ListTodoIcon size={13} />
      <span>{plan ? "Plan" : "Act"}</span>
    </button>
  );
}
