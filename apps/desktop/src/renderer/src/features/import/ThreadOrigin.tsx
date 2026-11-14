import type { Session } from "@capsule/shared";
import { harnessDisplayName } from "../../lib/harness";
import { useWorkspace } from "../../lib/workspace";
import { agentName } from "./ImportSessions";

/** Where this thread came from, and what that means for its next message. Nothing for a thread started here. */
export function ThreadOrigin({ session }: { session: Session }) {
  const { sessions, harnesses, setProjectId, setView } = useWorkspace();
  const origin = session.origin;
  if (!origin) return null;
  if (origin.kind === "import") {
    const name = agentName(origin.agent);
    return (
      <div className="thread-origin" role="note">
        <div className="thread-origin-text">
          <strong>Imported from {name}</strong>
          <span>
            {origin.continuation === "resume"
              ? `Your next message resumes the ${name} session this came from, with everything it remembers.`
              : `Read-only history. Your next message starts a fresh agent session that is given this transcript as context. ${origin.reason ?? ""}`}
          </span>
        </div>
      </div>
    );
  }
  const from = sessions.find((item) => item.id === origin.sessionId);
  const openFrom = from ? <button type="button" className="link-button" onClick={() => { setProjectId(from.projectId, from.id); setView("chat"); }}>{from.title}</button> : null;
  if (origin.kind === "task") {
    return (
      <div className="thread-origin" role="note">
        <div className="thread-origin-text">
          <strong>Created by {openFrom ?? "a thread that no longer exists"}</strong>
          <span>An agent in that thread put this task on the board with its task tools.</span>
        </div>
      </div>
    );
  }
  const brief = session.carryOver?.brief;
  return (
    <div className="thread-origin" role="note">
      <div className="thread-origin-text">
        <strong>
          Continued from{" "}
          {openFrom ?? "a thread that no longer exists"}
          {origin.fromHarnessId && origin.fromHarnessId !== session.harnessId ? ` on ${harnessDisplayName(harnesses, origin.fromHarnessId, origin.fromHarnessId)}` : ""}
        </strong>
        {brief ? (
          <details>
            <summary>The handoff summary goes with your first message.</summary>
            <pre>{brief}</pre>
          </details>
        ) : <span>The handoff summary went with the first message.</span>}
      </div>
    </div>
  );
}
