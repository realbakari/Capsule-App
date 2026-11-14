import type { Session } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { HistoryIcon } from "../shell/icons";
import "./automations.css";

/** Marks a thread an automation started, and whether anyone has opened it since. */
export function AutomationChip({ session }: { session: Session }) {
  const { config } = useWorkspace();
  if (!session.automationId) return null;
  const name = config?.automations.find((item) => item.key === session.automationId)?.name ?? session.automationId.split(":").pop();
  return (
    <small className="thread-automation" data-unread={session.unread ? "true" : undefined} title={`Automation: ${name}${session.unread ? " · not opened yet" : ""}`}>
      {session.unread && <i className="thread-unread-dot" aria-label="Unread" />}
      <HistoryIcon size={10} />Automation
    </small>
  );
}
