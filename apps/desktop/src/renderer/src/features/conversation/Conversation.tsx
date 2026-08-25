import { useEffect, useRef, useState } from "react";
import { CopyIcon } from "../shell/icons";
import { useWorkspace } from "../../lib/workspace";
import { GatewayBanner } from "../shell/GatewayBanner";
import { ViewErrorBoundary } from "../shell/ErrorBoundary";
import { Composer } from "./Composer";
import { MessageBody } from "./MessageBody";

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

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
    pickProjectDirectory,
    setDraft,
    setMode,
    connected,
  } = useWorkspace();

  const emptyPrompts = [
    { label: "Review this repo", mode: "code" as const, text: "Review the working directory and summarize the main risks." },
    { label: "Plan a change", mode: "plan" as const, text: "Help me plan the next change for this project." },
    { label: "Research options", mode: "research" as const, text: "Research options for this problem and cite sources." },
  ];
  const scroller = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);

  useEffect(() => {
    if (!stick) return;
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, activeRun, stick]);

  return (
    <section className="main page-content">
      {notice && <div className="notice">{notice}</div>}
      {statusText && <div className="notice status">{statusText}</div>}
      {!connected && (
        <GatewayBanner inset />
      )}
      <div
        className="conversation"
        ref={scroller}
        onScroll={(event) => {
          const node = event.currentTarget;
          const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          setStick((current) => (current === atBottom ? current : atBottom));
        }}
      >
        <div className="thread">
          {messages.length === 0 ? (
            <div className="empty-thread">
              <h1>
                {!project
                  ? "Open a folder to start"
                  : !project.workingDirectory
                    ? "Choose a code folder"
                    : session
                      ? "What should we work on?"
                      : "Pick a thread to continue"}
              </h1>
              <p>
                {!project || !project.workingDirectory
                  ? "Capsule works against a folder on disk. Open one to search files, run git, and spawn coding harnesses."
                  : session
                    ? "Ask for a change, a review, or research."
                    : "Select an existing conversation or start a new one."}
              </p>
              {project && session && (
                <div className="empty-prompts">
                  {emptyPrompts.map((item) => (
                    <button
                      key={item.label}
                      className="chip"
                      type="button"
                      onClick={() => {
                        setMode(item.mode);
                        setDraft(item.text);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
              {(!project || !project.workingDirectory) && (
                <div className="actions">
                  <button className="send" onClick={() => void pickProjectDirectory()}>
                    Open folder
                  </button>
                  <button className="chip" onClick={() => void createProjectFromFolder()}>
                    New project from folder
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
                  <span className="when">{formatTime(message.createdAt)}</span>
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
                <MessageBody content={message.content} />
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
                      {formatTime(event.timestamp)} {event.message}
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
                    <pre className="mono artifact-preview">{artifact.content.slice(0, 4000)}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {!stick && messages.length > 0 && (
        <button
          className="jump-latest"
          onClick={() => {
            setStick(true);
            const node = scroller.current;
            if (node) node.scrollTop = node.scrollHeight;
          }}
        >
          Latest
        </button>
      )}
      <ViewErrorBoundary compact label="Composer">
        <Composer showSuggestions={false} />
      </ViewErrorBoundary>
    </section>
  );
}
