import { GatewayBanner } from "../shell/GatewayBanner";
import { CopyIcon } from "../shell/icons";
import { useWorkspace } from "../../lib/workspace";
import { Composer } from "./Composer";

export function Conversation() {
  const {
    project,
    session,
    messages,
    agents,
    agentId,
    activeRun,
    steps,
    events,
    artifacts,
    pendingApproval,
    api,
    notice,
    statusText,
    createTask,
    createProjectFromFolder,
  } = useWorkspace();

  return (
    <section className="main page-content">
      <GatewayBanner inset />
      {notice && <div className="notice">{notice}</div>}
      {statusText && (
        <div className="notice status">
          {statusText}
        </div>
      )}
      <div className="conversation">
        {messages.length === 0 ? (
          <div className="empty-thread">
            <h1>
              {!project
                ? "Create a project to start"
                : session
                  ? "What should we work on?"
                  : "Pick a thread to continue"}
            </h1>
            <p>
              {!project
                ? "Open a folder as a project, then start a conversation. Claude Code and Codex are detected on this Mac — Capsule does not install them."
                : session
                  ? "Ask for a change, a review, or research. If Claude Code or Codex is already on this Mac, Capsule picks it up."
                  : "Select an existing conversation or start a new one."}
            </p>
            {!project && (
              <div className="actions">
                <button className="send" onClick={() => void createProjectFromFolder()}>
                  New project
                </button>
              </div>
            )}
            {project && !session && (
              <div className="actions">
                <button className="send" onClick={() => void createTask()}>
                  New conversation
                </button>
              </div>
            )}
          </div>
        ) : (
          messages.map((message) => (
            <div className={`msg ${message.role}`} key={message.id}>
              <div className="who">
                {message.role === "user"
                  ? "You"
                  : agents.find((item) => item.id === (session?.agentId ?? agentId))?.name ?? "Agent"}
                <span className="when">{message.createdAt.slice(11, 16)}</span>
                <span className="msg-actions">
                  <button
                    className="icon-btn"
                    title="Copy"
                    onClick={() => void navigator.clipboard.writeText(message.content)}
                  >
                    <CopyIcon size={13} />
                  </button>
                </span>
              </div>
              <div className="body">{message.content}</div>
            </div>
          ))
        )}
        {activeRun && (
          <div className="msg">
            <div className="who">Working on your task</div>
            <div className="progress">
              {steps.map((step) => (
                <div className={`step ${step.status}`} key={step.id}>
                  <span className="glyph">
                    {step.status === "complete" ? "✓" : step.status === "active" ? "●" : "○"}
                  </span>
                  {step.label}
                </div>
              ))}
            </div>
            <details className="advanced">
              <summary>Execution details</summary>
              <div className="event-log">
                {events.map((event) => (
                  <div key={event.id}>
                    {event.timestamp.slice(11, 19)} {event.message}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
        {pendingApproval && (
          <div className="approval">
            <h3>Approval required</h3>
            <div>
              {pendingApproval.agentName} wants to <b>{pendingApproval.action}</b>
            </div>
            <div className="mono">{pendingApproval.target}</div>
            <div className="muted">{pendingApproval.reason}</div>
            <div className="actions">
              <button
                className="send"
                onClick={() => void api.resolveApproval(pendingApproval.id, "approved_once")}
              >
                Approve once
              </button>
              <button
                className="chip"
                onClick={() => void api.resolveApproval(pendingApproval.id, "approved_session")}
              >
                Approve session
              </button>
              <button
                className="ghost"
                onClick={() => void api.resolveApproval(pendingApproval.id, "denied")}
              >
                Deny
              </button>
            </div>
          </div>
        )}
        {artifacts.length > 0 && !activeRun && (
          <div className="msg">
            <div className="who">Artifacts</div>
            {artifacts.map((artifact) => (
              <div className="card" key={artifact.id}>
                <b>{artifact.title}</b>
                <div className="muted">{artifact.kind}</div>
                {artifact.content && (
                  <pre className="mono" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                    {artifact.content.slice(0, 4000)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <Composer showSuggestions={messages.length === 0 && Boolean(session)} />
    </section>
  );
}
