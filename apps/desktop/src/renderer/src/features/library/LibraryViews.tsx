import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { SkillsDirectory } from "./SkillsDirectory";
import { TurnVerification } from "../conversation/TurnVerification";

export function SkillsView() {
  return (
    <section className="panel skills-panel">
      <div className="panel-inner">
        <SkillsDirectory />
      </div>
    </section>
  );
}

export function HistoryView() {
  const { projectRuns, sessions, projectId, setSessionId, setView } = useWorkspace();
  const items = [...projectRuns]
    .filter((item) => item.projectId === projectId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return (
    <section className="panel">
      <div className="panel-inner">
      <div className="panel-header">
        <p>Runs in the current project.</p>
      </div>
      {items.length === 0 && <p className="muted">No runs yet. Send a message to start one.</p>}
      {items.map((item) => {
        const session = sessions.find((entry) => entry.id === item.sessionId);
        return (
            <article key={item.id}>
          <button
            className="card"
            key={item.id}
            onClick={() => {
              setSessionId(item.sessionId);
              setView("chat");
            }}
          >
            <div className="row">
              <div>
                <b>{(item.prompt ?? "Run").slice(0, 80)}</b>
                <div className="muted">
                  {item.status}
                  {session?.title ? ` · ${session.title}` : ""}
                </div>
              </div>
              <span className="faint">{item.createdAt?.slice(11, 19) ?? ""}</span>
            </div>
          </button>
              <TurnVerification run={item} />
            </article>
        );
      })}
      </div>
    </section>
  );
}

export function ApprovalsView() {
  const { approvals, api, setNotice } = useWorkspace();
  return (
    <section className="panel">
      <div className="panel-inner">
      <div className="panel-header">
        <p>Host execution and policy gates waiting on you.</p>
      </div>
      {approvals.length === 0 && <p className="muted">No pending approvals.</p>}
      {approvals.map((item) => (
        <div className="card" key={item.id}>
          <b>{item.action}</b>
          <div className="mono">{item.target}</div>
          <div className="muted">{item.reason}</div>
          {item.status === "pending" && (
            <div className="actions">
              <button className="send" onClick={() => void api.resolveApproval(item.id, "approved_once").catch((error) => setNotice(formatUserError(error)))}>
                Approve once
              </button>
              <button className="ghost" onClick={() => void api.resolveApproval(item.id, "denied").catch((error) => setNotice(formatUserError(error)))}>
                Deny
              </button>
            </div>
          )}
        </div>
      ))}
      </div>
    </section>
  );
}
