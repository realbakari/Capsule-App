import { canSteerTurn } from "../../lib/harness";
import { useWorkspace } from "../../lib/workspace";
import { ArrowUpIcon, ArrowDownIcon, PencilIcon, XIcon } from "../shell/icons";

/**
 * Follow-ups waiting for the running turn, one compact row each. A row can be
 * steered into the running turn where the route allows it, edited in place
 * from the composer, reordered, or removed. After a turn that was stopped or
 * did not finish, the queue holds until the person sends it on.
 */
export function QueuedPrompts() {
  const { api, queue, followUpsBlocked, followUpsHeld, releaseQueued, removeQueued, moveQueued, editQueued, queuedEdit, steerQueued, session, harnesses, harnessStatuses, agentId, activeRun } = useWorkspace();
  if (queue.length === 0) {
    // Auto-resume can stop with nothing queued; say so rather than going quiet.
    return followUpsBlocked ? <p className="queued-prompts-blocked" role="status">{followUpsBlocked}</p> : null;
  }
  const harness = harnesses.find((item) => item.id === (session?.harnessId ?? agentId));
  // A paired device without conversation control can only read; one with it can tidy the queue but not steer.
  const readOnly = api.isDesktop === false && api.remoteMode !== "control";
  const canSteer = Boolean(activeRun) && canSteerTurn({ harness, session, status: session ? harnessStatuses?.[session.id] : undefined, desktop: api.isDesktop !== false });
  // With nothing running, a held queue waits for the person; Send now lets one row go first.
  const sendNow = Boolean(followUpsHeld) && !activeRun;
  return (
    <div className="queued-prompts" role="region" aria-label={queue.length === 1 ? "1 queued follow-up" : `${queue.length} queued follow-ups`}>
      {followUpsHeld && <p className="queued-prompts-held" role="status">
        <span>{followUpsHeld} Queued messages wait for you.</span>
        {!readOnly && !activeRun && <button type="button" className="ghost" onClick={() => releaseQueued()}>Resume queue</button>}
      </p>}
      {followUpsBlocked && <p className="queued-prompts-blocked" role="status">On hold: {followUpsBlocked}</p>}
      <ol className="queued-prompts-list">
        {queue.map((item, index) => (
          <li key={item.id} className="queued-prompt" aria-current={queuedEdit?.id === item.id ? "true" : undefined}>
            <span className="queued-prompt-text" title={item.content}>{item.content || "(attachments only)"}</span>
            {item.attachments.length > 0 && <span className="queued-prompt-meta">{item.attachments.length} file{item.attachments.length === 1 ? "" : "s"}</span>}
            {queuedEdit?.id === item.id && <span className="queued-prompt-meta">Editing</span>}
            {!readOnly && <span className="queued-prompt-actions">
              {/* Steering carries text only, so a row with files or a skill waits for its turn. */}
              {canSteer && !item.attachments.length && !item.skillId && <button type="button" className="queued-prompt-steer" title="Send into the running turn now" onClick={() => void steerQueued(item.id)}>Steer</button>}
              {sendNow && <button type="button" className="queued-prompt-steer" title="Send this one now, then the rest in order" onClick={() => releaseQueued(item.id)}>Send now</button>}
              <button type="button" className="icon-btn" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => moveQueued(item.id, "up")}><ArrowUpIcon size={12} /></button>
              <button type="button" className="icon-btn" title="Move down" aria-label="Move down" disabled={index === queue.length - 1} onClick={() => moveQueued(item.id, "down")}><ArrowDownIcon size={12} /></button>
              <button type="button" className="icon-btn" title="Edit in place" aria-label="Edit queued message" aria-pressed={queuedEdit?.id === item.id} onClick={() => editQueued(item.id)}><PencilIcon size={12} /></button>
              <button type="button" className="icon-btn" title="Remove from queue" aria-label="Remove from queue" onClick={() => removeQueued(item.id)}><XIcon size={12} /></button>
            </span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
