import type { PlanModeSupport } from "@capsule/shared";
import { ListTodoIcon, XIcon } from "../shell/icons";

/**
 * Shown only while the next turn is a plan turn; Act is the unmarked default.
 * The tooltip says who enforces it: the agent, a read-only sandbox, or only
 * Capsule's request. Pressing it, or ⇧Tab, goes back to Act.
 */
export function TurnModeChip({ support, onTurnOff, disabledReason }: {
  support: PlanModeSupport;
  onTurnOff: () => void;
  disabledReason?: string;
}) {
  const title = disabledReason ?? `Plan: ${support.label}. ${support.detail} Press to go back to Act (⇧Tab).`;
  return (
    <button type="button" className={`turn-mode-chip is-plan${support.enforced ? "" : " is-asked"}`}
      aria-label="Turn off plan mode" aria-description={support.label}
      aria-disabled={disabledReason ? true : undefined} title={title}
      onClick={() => { if (!disabledReason) onTurnOff(); }}>
      <ListTodoIcon size={13} />
      <span>Plan</span>
      <XIcon size={11} />
    </button>
  );
}
