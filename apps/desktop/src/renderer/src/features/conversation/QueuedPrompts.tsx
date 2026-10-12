import { harnessCapabilities } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { ArrowUpIcon, ArrowDownIcon, PencilIcon, XIcon } from "../shell/icons";

/**
 * Follow-ups waiting for the running turn. Each row can be edited back into
 * the composer, reordered, removed, or, where the route can steer, sent into
 * the running turn right now.
 */
export function QueuedPrompts() {
  const { queue, removeQueued, moveQueued, editQueued, steerQueued, session, harnesses, harnessStatuses, agentId } = useWorkspace();
  if (queue.length === 0) return null;
  const harness = harnesses.find((item) => item.id === (session?.harnessId ?? agentId));
  const canSteer = harnessCapabilities({ harness, session, status: session ? harnessStatuses?.[session.id] : undefined }).steer.state !== "unavailable";
  return (
    <div className="queued-prompts" role="region" aria-label="Queued follow-ups">
      <div className="queued-prompts-head">
        <strong>{queue.length === 1 ? "1 follow-up queued" : `${queue.length} follow-ups queued`}</strong>
        <span className="faint">Sent in order when this turn finishes.</span>
      </div>
      <ol className="queued-prompts-list">
        {queue.map((item, index) => (
          <li key={item.id} className="queued-prompt">
            <span className="queued-prompt-text" title={item.content}>{item.content || "(attachments only)"}</span>
            {item.attachments.length > 0 && <span className="queued-prompt-meta">{item.attachments.length} file{item.attachments.length === 1 ? "" : "s"}</span>}
            <span className="queued-prompt-actions">
              {canSteer && <button type="button" className="chip" title="Send into the running turn now" onClick={() => void steerQueued(item.id)}>Steer now</button>}
              <button type="button" className="icon-btn" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => moveQueued(item.id, "up")}><ArrowUpIcon size={12} /></button>
              <button type="button" className="icon-btn" title="Move down" aria-label="Move down" disabled={index === queue.length - 1} onClick={() => moveQueued(item.id, "down")}><ArrowDownIcon size={12} /></button>
              <button type="button" className="icon-btn" title="Edit in the composer" aria-label="Edit in the composer" onClick={() => editQueued(item.id)}><PencilIcon size={12} /></button>
              <button type="button" className="icon-btn" title="Remove" aria-label="Remove from queue" onClick={() => removeQueued(item.id)}><XIcon size={12} /></button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
