import type { Session } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { HistoryIcon } from "../shell/icons";
import "./automations.css";

/** Marks a thread an automation started. Whether it is unread is the row's own triage mark. */
export function AutomationChip({ session }: { session: Session }) {
  const { config } = useWorkspace();
  if (!session.automationId) return null;
  const name = config?.automations.find((item) => item.key === session.automationId)?.name ?? session.automationId.split(":").pop();
  return (
    <small className="thread-automation" title={`Automation: ${name}`}>
      <HistoryIcon size={10} />Automation
    </small>
  );
}
