import { useWorkspace } from "../../lib/workspace";

export function SkillsView() {
  const { skills, skillId, setSkillId, setView } = useWorkspace();
  return (
    <section className="panel">
      <div className="panel-inner">
      <div className="panel-header">
        <p>Installed capabilities. Click one to attach it to the composer as $skill.</p>
      </div>
      {skills.length === 0 && <p className="muted">No skills loaded yet.</p>}
      {skills.map((item) => (
        <button
          className={`card ${skillId === item.id ? "active" : ""}`}
          key={item.id}
          type="button"
          onClick={() => {
            setSkillId(item.id);
            setView("chat");
          }}
        >
          <div className="row">
            <div>
              <b>{item.name}</b>
              <div className="muted">{item.description}</div>
            </div>
            <span className="muted">{skillId === item.id ? "attached" : item.status}</span>
          </div>
        </button>
      ))}
      </div>
    </section>
  );
}

export function HistoryView() {
  const { projectRuns, sessions, setSessionId, setView } = useWorkspace();
  const items = [...projectRuns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
        );
      })}
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
