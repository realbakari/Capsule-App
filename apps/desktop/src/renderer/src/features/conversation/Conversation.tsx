import { useWorkspace } from "../../lib/workspace";
import { Composer } from "./Composer";

const SUGGESTIONS = [
  {
    label: "Review this repo",
    mode: "code" as const,
    text: "Review the working directory and summarize the main risks.",
  },
  {
    label: "Plan a change",
    mode: "agent" as const,
    text: "Help me plan the next change for this project.",
  },
  {
    label: "Research options",
    mode: "research" as const,
    text: "Research options for this problem and cite sources.",
  },
];

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
    setMode,
    setDraft,
    cancelHarness,
    closeHarness,
    refreshHarnessStatus,
    statusText,
  } = useWorkspace();
  const harnessLive = Boolean(session?.harnessId && session.harnessState && session.harnessState !== "closed");

  return (
    <section className="main">
      <div className="conversation-header">
        <div className="title">
          <b>{project?.name ?? "Inbox"}</b>
          {session ? ` · ${session.title}` : ""}
        </div>
        <div className="header-actions">
          {activeRun && (
            <button className="ghost" onClick={() => void api.stopRun(activeRun.id)}>
              Stop run
            </button>
          )}
        </div>
      </div>
      {harnessLive && (
        <div className="harness-bar">
          <span className="badge">{session?.harnessId === "codex" ? "Codex" : "Claude Code"}</span>
          <span>{session?.harnessState}</span>
          {session?.acpMode && <span className="faint">{session.acpMode}</span>}
          <span className="grow" />
          <button className="ghost" onClick={() => void refreshHarnessStatus()}>
            Status
          </button>
          <button className="ghost" onClick={() => void cancelHarness()}>
            Cancel
          </button>
          <button className="danger" onClick={() => void closeHarness()}>
            Close
          </button>
        </div>
      )}
      {statusText && (
        <div className="harness-bar">
          <span className="mono">{statusText}</span>
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      <div className="conversation">
        {messages.length === 0 ? (
          <div className="hero">
            <h1>What should Capsule work on?</h1>
            <p>
              Ask for a change, a review, or research. Capsule routes the work, records the run, and
              keeps the project context. Dedicate Claude Code or Codex to send code work through ACP.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((item) => (
                <button
                  key={item.label}
                  className="chip"
                  onClick={() => {
                    setMode(item.mode);
                    setDraft(item.text);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div className={`msg ${message.role}`} key={message.id}>
              <div className="who">
                {message.role === "user"
                  ? "You"
                  : agents.find((item) => item.id === (session?.agentId ?? agentId))?.name ?? "Agent"}
                <span className="when">{message.createdAt.slice(11, 16)}</span>
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
              </div>
            ))}
          </div>
        )}
      </div>
      <Composer />
    </section>
  );
}
