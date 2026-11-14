import type { Session } from "@capsule/shared";
import { agentName } from "./ImportSessions";

/** Where this thread came from, and what that means for its next message. Nothing for a thread started here. */
export function ThreadOrigin({ session }: { session: Session }) {
  const origin = session.origin;
  if (!origin) return null;
  {
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
}
