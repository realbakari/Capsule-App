import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@capsule/shared";
import { CopyIcon, DiffIcon, FileIcon, SparkIcon, TerminalIcon, XIcon } from "../shell/icons";
import { useWorkspace } from "../../lib/workspace";
import { GatewayBanner } from "../shell/GatewayBanner";
import { ViewErrorBoundary } from "../shell/ErrorBoundary";
import { Composer } from "./Composer";
import { TerminalDock } from "../terminal/TerminalDock";
import {
  foldedTurnIds,
  foldedTurnLabel,
  formatDuration,
  turnDurationMs,
  reconcileTurns,
  turnPreview,
  turnsFromMessages,
  type Turn,
} from "../../lib/turns";
import { RunSummary } from "./RunSummary";
import { summariseWork } from "../../lib/activity";
import { ChangedFilesCard } from "./ChangedFilesCard";
import { MessageBody } from "./MessageBody";

/*
 * One message. Memoized because a streamed frame appends a message rather
 * than editing one: without this, every row in the thread re-rendered on
 * every frame.
 */
const MessageRow = memo(function MessageRow({
  message,
  isNew,
  onOpenAttachment,
}: {
  message: ChatMessage;
  isNew: boolean;
  onOpenAttachment: (path: string) => void;
}) {
  return (
    <div className={`msg ${message.role}${isNew ? " motion-enter-conversation" : ""}`}>
      {/* No author label: a right-aligned bubble already says "you", and the
          reply is the timeline — naming it "Agent" on every turn is chrome.
          Timestamp and copy appear on hover. */}
      <div className="who">
        {message.kind === "steer" && <span className="tag">Steer</span>}
        <span className="when">{formatTime(message.createdAt)}</span>
        <span className="msg-actions">
          <button
            className="icon-btn"
            title="Copy"
            aria-label="Copy"
            onClick={() => void navigator.clipboard.writeText(message.content)}
          >
            <CopyIcon size={13} />
          </button>
        </span>
      </div>
      {message.content ? <MessageBody content={message.content} /> : null}
      {message.attachments?.length ? (
        <div className="message-attachments">
          {message.attachments.map((attachment) => (
            <button
              type="button"
              className="message-attachment"
              key={attachment.path}
              title={attachment.path}
              onClick={() => onOpenAttachment(attachment.path)}
            >
              <FileIcon size={13} />
              <span>{attachment.name}</span>
              <small>{Math.max(1, Math.ceil(attachment.size / 1024))} KB</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});

/** A folded exchange: one row that says what happened and how long it took. */
const FoldedTurn = memo(function FoldedTurn({
  turn,
  onOpen,
}: {
  turn: Turn;
  onOpen: (id: string) => void;
}) {
  const preview = turnPreview(turn);
  const elapsed = turnDurationMs(turn);
  return (
    <button className="turn-fold" onClick={() => onOpen(turn.id)}>
      <span className="turn-fold-count">{turn.messages.length} messages</span>
      <span className="turn-fold-label">{foldedTurnLabel(turn)}</span>
      {/* Hover shows the prompt and the start of the answer, so a folded turn
          can be identified without unfolding it. */}
      {preview.prompt || preview.reply ? (
        <span className="turn-fold-preview" role="tooltip">
          {preview.prompt && <span className="turn-fold-preview-prompt">{preview.prompt}</span>}
          {preview.reply && <span className="turn-fold-preview-reply">{preview.reply}</span>}
        </span>
      ) : null}
      {elapsed ? <span className="turn-fold-duration">{formatDuration(elapsed)}</span> : null}
    </button>
  );
});

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
    ready,
    runs,
    setNotice,
    statusText,
    createTask,
    createProjectFromFolder,
    pickProjectDirectory,
    connected,
    settings,
    openPath,
    terminalOpen,
    setTerminalOpen,
  } = useWorkspace();

  /* Older exchanges fold to one row so a long thread stays skimmable; the
     newest few always stay open, and anything you open stays open. */
  const [openedTurns, setOpenedTurns] = useState<ReadonlySet<string>>(() => new Set());
  /* Every streamed frame rebuilds the turn list. Handing the rows the objects
     from the last render wherever the messages did not move is what lets the
     memoized rows below skip a re-render of the whole thread per frame. */
  const previousTurns = useRef<Turn[]>([]);
  const turns = useMemo(() => {
    const next = reconcileTurns(previousTurns.current, turnsFromMessages(messages));
    previousTurns.current = next;
    return next;
  }, [messages]);

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

  /* The shell opens where the conversation works: its worktree when it has
     one, the project folder otherwise. */
  const terminalCwd = session?.workingDirectory ?? project?.workingDirectory;

  /*
   * A turn that wrote something leaves a checkpoint behind — the hidden ref
   * the engine captures when a run finishes. Without one, whatever git is
   * reporting belongs to the person at the keyboard, not to this thread.
   */
  const turnTouchedTree = runs.some((run) => Boolean(run.checkpointRef));

  const openTurn = useCallback((id: string) => {
    setOpenedTurns((current) => new Set(current).add(id));
  }, []);
  const openAttachment = useCallback((path: string) => void openPath(path), [openPath]);

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
    <section className={`main page-content${ready && messages.length === 0 ? " conversation-empty" : ""}`}>
      {notice && (
        <div className="notice notice-dismissable" role="status">
          <span>{notice}</span>
          <button
            type="button"
            className="icon-btn"
            title="Dismiss"
            aria-label="Dismiss"
            onClick={() => setNotice(undefined)}
          >
            <XIcon size={12} />
          </button>
        </div>
      )}
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
          {/*
           * Nothing until the first load lands. Projects, conversations and
           * messages all start empty, which is indistinguishable from a real
           * empty workspace — so every launch flashed "What should we work
           * on?" and an Attach folder button before the real thread appeared.
           */}
          {!ready ? (
            <div className="thread-hydrating" aria-hidden />
          ) : messages.length === 0 ? (
            <div className="empty-thread">
              <h1>
                {project && session && project.name !== "Inbox" ? (
                  <>What should we build in <span>{project.name}</span>?</>
                ) : project && !session ? (
                  "Pick a conversation to continue"
                ) : (
                  "What should we work on?"
                )}
              </h1>
              {(!project || !session || !project.workingDirectory) && (
                <p>
                  {!project || !session
                    ? "Start a conversation, or attach a folder when the work needs a repo."
                    : project.name === "Inbox"
                      ? "This chat isn't bound to a repo. Attach a folder or start a project from one."
                      : "Attach a folder so Capsule can search files, run git, and start coding harnesses."}
                </p>
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
                  <FoldedTurn key={turn.id} turn={turn} onOpen={openTurn} />
                ) : (
                  turn.messages.map((message, messageIndex) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      isNew={(turnOffsets.get(turn.id) ?? 0) + messageIndex >= initialCountRef.current}
                      onOpenAttachment={openAttachment}
                    />
                  ))
                ),
              )}
              {/* The turn's outcome on disk, under the reply. Not a second copy
                  of the reply — the diff itself lives in the side panel. */}
              {/* Only when a turn in this thread actually touched the tree.
                  It used to render on any working-tree change at all, so a
                  chat that asked "how are you" ended with a card announcing
                  ".DS_Store" and a folder you cloned yourself as its outcome. */}
              {git && session && turnTouchedTree && <ChangedFilesCard git={git} />}
            </>
          )}
          {/* The work log belongs to the turn, not to the moment it is running.
              It used to be mounted on activeRun alone, so the record of what
              the agent did — every command, every file — disappeared the
              instant the turn finished, and the only way back to it was to
              start another one. */}
          {(activeRun || steps.length > 0) && (
            <div className={`msg active-run-msg${activeRun ? "" : " settled"}`}>
              {activeRun ? (
                <div className="who">
                  <span className="shimmer-text">
                    Working
                    <span className="shimmer-overlay" aria-hidden>Working</span>
                  </span>
                  {activeRun.createdAt && <RunElapsed startedAt={activeRun.createdAt} />}
                </div>
              ) : null}
              <RunSummary label={summariseWork(steps).label} isComplete={!activeRun}>
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
                      {step.id === "thinking" && step.body && (
                        <details className="thinking">
                          <summary>Show full reasoning</summary>
                          <div className="thinking-body">{step.body}</div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </RunSummary>
              {/* Only when something went wrong. A raw list of stream frames
                  with timestamps is what you want when a turn failed and
                  nothing you would ever open when it did not. */}
              {activeRun?.status === "failed" || activeRun?.status === "blocked" ? (
              <details className="advanced">
                <summary>What the agent reported</summary>
                <div className="event-log">
                  {events
                    .filter((event) => {
                      if (!event.message?.trim()) return false;
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
              ) : null}
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
      {terminalOpen && terminalCwd && (
        <ViewErrorBoundary compact label="Terminal">
          <TerminalDock cwd={terminalCwd} onClose={() => setTerminalOpen(false)} />
        </ViewErrorBoundary>
      )}
    </section>
  );
}
