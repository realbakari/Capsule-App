import { canSteerTurn } from "../../lib/harness";
import { useWorkspace } from "../../lib/workspace";
import { ArrowUpIcon, ArrowDownIcon, PencilIcon, XIcon } from "../shell/icons";

/**
 * Follow-ups waiting for the running turn, one compact row each. A row can be
 * steered into the running turn where the route allows it, edited back into
 * the composer, reordered, or removed.
 */
export function QueuedPrompts() {
  const { api, queue, followUpsBlocked, removeQueued, moveQueued, editQueued, steerQueued, session, harnesses, harnessStatuses, agentId } = useWorkspace();
  if (queue.length === 0) {
    // Auto-resume can stop with nothing queued; say so rather than going quiet.
    return followUpsBlocked ? <p className="queued-prompts-blocked" role="status">{followUpsBlocked}</p> : null;
  }
  const harness = harnesses.find((item) => item.id === (session?.harnessId ?? agentId));
  // A paired device without conversation control can only read; one with it can tidy the queue but not steer.
  const readOnly = api.isDesktop === false && api.remoteMode !== "control";
  const canSteer = canSteerTurn({ harness, session, status: session ? harnessStatuses?.[session.id] : undefined, desktop: api.isDesktop !== false });
  return (
    <div className="queued-prompts" role="region" aria-label={queue.length === 1 ? "1 queued follow-up" : `${queue.length} queued follow-ups`}>
      {followUpsBlocked && <p className="queued-prompts-blocked" role="status">On hold: {followUpsBlocked}</p>}
      <ol className="queued-prompts-list">
        {queue.map((item, index) => (
          <li key={item.id} className="queued-prompt">
            <span className="queued-prompt-text" title={item.content}>{item.content || "(attachments only)"}</span>
            {item.attachments.length > 0 && <span className="queued-prompt-meta">{item.attachments.length} file{item.attachments.length === 1 ? "" : "s"}</span>}
            {!readOnly && <span className="queued-prompt-actions">
              {canSteer && <button type="button" className="queued-prompt-steer" title="Send into the running turn now" onClick={() => void steerQueued(item.id)}>Steer</button>}
              <button type="button" className="icon-btn" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => moveQueued(item.id, "up")}><ArrowUpIcon size={12} /></button>
              <button type="button" className="icon-btn" title="Move down" aria-label="Move down" disabled={index === queue.length - 1} onClick={() => moveQueued(item.id, "down")}><ArrowDownIcon size={12} /></button>
              <button type="button" className="icon-btn" title="Edit in the composer" aria-label="Edit in the composer" onClick={() => editQueued(item.id)}><PencilIcon size={12} /></button>
              <button type="button" className="icon-btn" title="Remove from queue" aria-label="Remove from queue" onClick={() => removeQueued(item.id)}><XIcon size={12} /></button>
            </span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
