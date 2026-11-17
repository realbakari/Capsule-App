import { threadShelf, type Session } from "@capsule/shared";
import { formatWakeTime, useThreadTriage } from "../../lib/thread-triage";
import { useWorkspace } from "../../lib/workspace";
import "./triage.css";

/**
 * Under a settled or snoozed thread's last turn: what shelf it is on, and the
 * way back. The sidebar shelf is the only other place that says so, and a
 * thread opened from search or a link would otherwise look active.
 */
export function ShelfNote({ session }: { session: Session }) {
  const { settings } = useWorkspace();
  const triage = useThreadTriage();
  const shelf = threadShelf(session);
  if (shelf === "active") return null;
  const snoozed = shelf === "snoozed";
  return (
    <div className="shelf-note" role="note">
      <span>{snoozed ? `Snoozed until ${formatWakeTime(session.snoozedUntil!, new Date(), settings?.timeFormat)}` : "Settled. It stays in the Settled shelf until a turn starts."}</span>
      {triage.writable && (
        <button type="button" className="chip" onClick={() => void (snoozed ? triage.wake(session.id) : triage.unsettle(session.id))}>
          {snoozed ? "Wake now" : "Return to active"}
        </button>
      )}
    </div>
  );
}
