import { useEffect, useMemo, useRef, useState } from "react";
import { CopyIcon, DiffIcon, FileIcon, SparkIcon, TerminalIcon } from "../shell/icons";
import { useWorkspace } from "../../lib/workspace";
import { GatewayBanner } from "../shell/GatewayBanner";
import { ViewErrorBoundary } from "../shell/ErrorBoundary";
import { Composer } from "./Composer";
import {
  foldedTurnIds,
  foldedTurnLabel,
  formatDuration,
  turnDurationMs,
  turnPreview,
  turnsFromMessages,
} from "../../lib/turns";
import { ChangedFilesCard } from "./ChangedFilesCard";
import { MessageBody } from "./MessageBody";

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Newest turns that never fold. */
const KEEP_EXPANDED_TURNS = 3;


/**
 * Elapsed time for the running turn, ticking once a second.
 *
 * The interval is cleared with the component: a timer left running behind a
 * closed thread repaints the whole transcript every second for nothing.
 */
function RunElapsed({ startedAt }: { startedAt: string }) {
  const startedMs = Date.parse(startedAt);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1_000);
    return () => window.clearInterval(id);
  }, [startedMs]);
  if (Number.isNaN(startedMs)) return null;
  return <span className="run-elapsed">for {formatDuration(Date.now() - startedMs)}</span>;
}

/**
 * What kind of work a row is, at a glance. The status glyph says whether it
 * finished; this says what it was, so a list of rows can be skimmed without
 * reading every label.
 */
function StepIcon({ id }: { id: string }) {
  const action = id.startsWith("work:") ? id.slice(5) : id;
  const Icon =
    action === "ran"
      ? TerminalIcon
      : action === "read"
        ? FileIcon
        : action === "changed"
          ? DiffIcon
          : action === "thinking"
            ? SparkIcon
            : undefined;
  if (!Icon) return null;
  return (
    <span className="step-icon" aria-hidden>
      <Icon size={12} />
    </span>
  );
}

export function Conversation() {
  const {
    project,
    session,
    messages,
    git,
    hasOlderMessages,
    loadingOlder,
    loadOlderMessages,
    agents,
    agentId,
    activeRun,
    steps,
    events,
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
    settings,
  } = useWorkspace();

  /* Older exchanges fold to one row so a long thread stays skimmable; the
     newest few always stay open, and anything you open stays open. */
  const [openedTurns, setOpenedTurns] = useState<ReadonlySet<string>>(() => new Set());
  const turns = useMemo(() => turnsFromMessages(messages), [messages]);

  /*
   * Where each turn starts in the flat message list, so a row can tell whether
   * it arrived after the thread was opened.
   *
   * This used to be computed per message, inside the render loop, as
   * `turns.indexOf(turn)` followed by `turns.slice(0, turnIndex).reduce(...)`
   * — a linear scan and a fresh array allocation for every message on every
   * render, and renders happen on every streamed token. One pass over the
   * turns replaces O(messages x turns) with O(turns).
   */
  const turnOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    let total = 0;
    for (const turn of turns) {
      offsets.set(turn.id, total);
      total += turn.messages.length;
    }
    return offsets;
  }, [turns]);
  const folded = useMemo(
    () => foldedTurnIds(turns, KEEP_EXPANDED_TURNS, openedTurns),
    [turns, openedTurns],
  );

  const emptyPrompts = [
    { label: "Review this repo", mode: "code" as const, text: "Review the working directory and summarize the main risks." },
    { label: "Plan a change", mode: "plan" as const, text: "Help me plan the next change for this project." },
    { label: "Research options", mode: "research" as const, text: "Research options for this problem and cite sources." },
  ];
  const scroller = useRef<HTMLDivElement>(null);
  /* Track the message count at mount time so entrance animations only fire for
     messages that arrive after the initial load, not the whole history. */
  const initialCountRef = useRef(messages.length);
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
                  ? "What should we work on?"
                  : session
                    ? "What should we work on?"
                    : "Pick a thread to continue"}
              </h1>
              <p>
                {!project || !session
                  ? "Start a conversation, or attach a folder when the work needs a repo."
                  : !project.workingDirectory && project.name === "Inbox"
                    ? "This chat isn't bound to a repo. Attach a folder or start a project from one."
                    : !project.workingDirectory
                      ? "Attach a folder so Capsule can search files, run git, and spawn coding harnesses."
                      : "Ask for a change, a review, or research."}
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
                    Attach folder
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
            <>
              {hasOlderMessages && (
                <div className="load-older">
                  <button className="ghost" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>
                    {loadingOlder ? "Loading…" : "Load older messages"}
                  </button>
                </div>
              )}
              {loadingOlder && (
                <div className="skeleton-thread-loading" style={{ padding: "0.5rem 0 1rem", display: "grid", gap: "0.5rem" }}>
                  <div className="skeleton skeleton-line short" />
                  <div className="skeleton skeleton-line medium" />
                </div>
              )}
              {turns.map((turn) =>
                folded.has(turn.id) ? (
                  <button
                    className="turn-fold"
                    key={turn.id}
                    onClick={() =>
                      setOpenedTurns((current) => new Set(current).add(turn.id))
                    }
                  >
                    <span className="turn-fold-count">
                      {turn.messages.length} messages
                    </span>
                    <span className="turn-fold-label">{foldedTurnLabel(turn)}</span>
                    {/* Hover shows the prompt and the start of the answer, so a
                        folded turn can be identified without unfolding it. */}
                    {(() => {
                      const preview = turnPreview(turn);
                      if (!preview.prompt && !preview.reply) return null;
                      return (
                        <span className="turn-fold-preview" role="tooltip">
                          {preview.prompt && (
                            <span className="turn-fold-preview-prompt">{preview.prompt}</span>
                          )}
                          {preview.reply && (
                            <span className="turn-fold-preview-reply">{preview.reply}</span>
                          )}
                        </span>
                      );
                    })()}
                    {(() => {
                      const elapsed = turnDurationMs(turn);
                      return elapsed ? (
                        <span className="turn-fold-duration">{formatDuration(elapsed)}</span>
                      ) : null;
                    })()}
                  </button>
                ) : (
                  turn.messages.map((message, messageIndex) => {
              const globalIndex = (turnOffsets.get(turn.id) ?? 0) + messageIndex;
              const isNew = globalIndex >= initialCountRef.current;
              return (
              <div className={`msg ${message.role}${isNew ? " motion-enter-conversation" : ""}`} key={message.id}>
                {/* No author label: a right-aligned bubble already says "you",
                    and the reply is the timeline — naming it "Agent" on every
                    turn is chrome. Timestamp and copy appear on hover. */}
                <div className="who">
                  {message.kind === "steer" && <span className="tag">Steer</span>}
                  <span className="when">{formatTime(message.createdAt)}</span>
                  <span className="msg-actions">
                    <button
                      className="icon-btn"
                      title="Copy" aria-label="Copy"
                      onClick={() => void navigator.clipboard.writeText(message.content)}
                    >
                      <CopyIcon size={13} />
                    </button>
                  </span>
                </div>
                <MessageBody content={message.content} />
              </div>
                  );
                })
                ),
              )}
              {/* The turn's outcome on disk, under the reply. Not a second copy
                  of the reply — the diff itself lives in the side panel. */}
              {git && session && <ChangedFilesCard git={git} />}
            </>
          )}
          {activeRun && (
            <div className="msg">
              {/* Elapsed time, not just a spinner. A turn can run for minutes;
                  "working" alone gives no way to tell a slow one from a stuck
                  one. The sidebar already counted this and the transcript did
                  not. */}
              <div className="who">
                <span className="shimmer-text">
                  Working
                  <span className="shimmer-overlay" aria-hidden>Working</span>
                </span>
                {activeRun.createdAt && <RunElapsed startedAt={activeRun.createdAt} />}
              </div>
              <div className="progress">
                {steps.map((step) => (
                  <div key={step.id}>
                    <div className={`step ${step.status}`}>
                      <span className="glyph">
                        {step.status === "error" ? "✕" : step.status === "complete" ? "✓" : "●"}
                      </span>
                      <StepIcon id={step.id} />
                      <span className="step-label">{step.label}</span>
                      {step.detail && (
                        <span className={`step-detail${step.status === "active" ? " shimmer-text" : ""}`}>
                          {step.detail}
                          {step.status === "active" && (
                            <span className="shimmer-overlay" aria-hidden>{step.detail}</span>
                          )}
                        </span>
                      )}
                    </div>
                    {/* The row shows the latest fragment; the agent's whole
                        thought is here for anyone who wants it. */}
                    {step.id === "thinking" && step.body && (
                      <details className="thinking">
                        <summary>Show full reasoning</summary>
                        <div className="thinking-body">{step.body}</div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
              <details className="advanced">
                <summary>Execution details</summary>
                <div className="event-log">
                  {/* Many frames carry a kind but no text (a tool call with no
                      output, a lifecycle tick). Rendering those produced rows
                      that were just a bare timestamp. */}
                  {events
                    .filter((event) => {
                      if (!event.message?.trim()) return false;
                      /* request / route / skill / contract are Capsule's own
                         bookkeeping, not anything the agent did. Listing them
                         made the log read like progress while saying nothing. */
                      if (!event.data?.streamKind) return false;
                      if (settings?.reasoningSummary !== "hidden") return true;
                      const kind = String(event.data.streamKind).toLowerCase();
                      return !kind.startsWith("think") && !kind.startsWith("reason");
                    })
                    .map((event) => (
                      <div key={event.id}>
                        <span className="event-time">{formatTime(event.timestamp)}</span>
                        <span className="event-kind">
                          {String(event.data?.streamKind ?? event.type)}
                        </span>
                        <span className="event-text">{event.message.trim()}</span>
                      </div>
                    ))}
                  {events.every((event) => !event.message?.trim()) && (
                    <div className="faint">No output yet.</div>
                  )}
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
