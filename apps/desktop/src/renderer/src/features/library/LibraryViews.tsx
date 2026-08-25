import { useWorkspace } from "../../lib/workspace";

export function SkillsView() {
  const { skills } = useWorkspace();
  return (
    <section className="panel">
      <div className="panel-inner">
      <div className="panel-header">
        <h2>Skills</h2>
        <p>Installed capabilities Capsule can attach to a run.</p>
      </div>
      {skills.map((item) => (
        <div className="card" key={item.id}>
          <div className="row">
            <div>
              <b>{item.name}</b>
              <div className="muted">{item.description}</div>
            </div>
            <span className="muted">{item.status}</span>
          </div>
        </div>
      ))}
      </div>
    </section>
  );
}

export function HistoryView() {
  const { runs, setSessionId, setView } = useWorkspace();
  return (
    <section className="panel">
      <div className="panel-inner">
      <div className="panel-header">
        <h2>History</h2>
        <p>Runs in the current project.</p>
      </div>
      {runs.length === 0 && <p className="muted">No runs yet.</p>}
      {runs.map((item) => (
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
              <b>{item.prompt.slice(0, 80)}</b>
              <div className="muted">{item.status}</div>
            </div>
            <span className="faint">{item.createdAt.slice(11, 19)}</span>
          </div>
        </button>
      ))}
      </div>
    </section>
  );
}

export function ApprovalsView() {
  const { approvals, api } = useWorkspace();
  return (
    <section className="panel">
      <div className="panel-inner">
      <div className="panel-header">
        <h2>Approvals</h2>
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
              <button className="send" onClick={() => void api.resolveApproval(item.id, "approved_once")}>
                Approve once
              </button>
              <button className="ghost" onClick={() => void api.resolveApproval(item.id, "denied")}>
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
