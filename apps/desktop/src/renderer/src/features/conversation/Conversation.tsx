import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Run } from "@capsule/shared";
import { harnessDisplayName } from "../../lib/harness";
import { AgentGlyph } from "../shell/AgentGlyph";
import { formatTokens, type ContextUsage } from "../../lib/context-window";
import { AlertTriangleIcon, CopyIcon, DiffIcon, FileIcon, SparkIcon, TerminalIcon, XIcon } from "../shell/icons";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { GatewayBanner } from "../shell/GatewayBanner";
import { ViewErrorBoundary } from "../shell/ErrorBoundary";
import { Composer } from "./Composer";
import { PersistentTerminals } from "../terminal/TerminalDock";
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
import { summariseWork, extractTouchedFiles } from "../../lib/activity";
import { outcomesByTurn } from "../../lib/turn-outcomes";
import { threadFeedback } from "../../lib/thread-error";
import { TurnOutcome } from "./TurnOutcome";
import { TurnVerification } from "./TurnVerification";
import { TurnFilesCard } from "./TurnFilesCard";
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
function RunElapsed({ startedAt }: { startedAt: string; }) {
  const startedMs = Date.parse(startedAt);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1_000);
    return () => window.clearInterval(id);
  }, [startedMs]);
  if (Number.isNaN(startedMs)) return null;
  return <span className="run-elapsed">{formatDuration(Date.now() - startedMs)}</span>;
}

/**
 * One line for a turn in flight: how long, how much, and what it is doing.
 *
 * These three facts were all in the app and none of them together — the clock
 * beside the word "Working", the token count inside a ring's tooltip, and what
 * the agent was actually doing further down the work log. Waiting is the whole
 * experience of a slow turn, and this is the line someone watches while it
 * happens.
 */
function TurnStatusLine({
  run,
  agentId,
  agentName,
  usage,
  activity,
}: {
  run: Run;
  agentId?: string;
  agentName: string;
  usage?: ContextUsage;
  activity?: string;
}) {
  // The agent's own most recent step when there is one; otherwise the honest
  // answer, which is that nothing has come back yet.
  const state = activity?.trim() || `Waiting for ${agentName}`;
  return (
    <div className="turn-status">
      {agentId ? <AgentGlyph id={agentId} name={agentName} size={14} /> : null}
      {run.createdAt && <RunElapsed startedAt={run.createdAt} />}
      {usage ? (
        <>
          <span className="turn-status-dot" aria-hidden>·</span>
          <span
            className="turn-status-tokens"
            title={`${formatTokens(usage.used)} of ${formatTokens(usage.limit)} context`}
          >
            {formatTokens(usage.used)} tokens
          </span>
        </>
      ) : null}
      <span className="turn-status-dot" aria-hidden>·</span>
      <span className="shimmer-text turn-status-state" title={state}>
        {state}…
        <span className="shimmer-overlay" aria-hidden>
          {state}…
        </span>
      </span>
    </div>
  );
}

/**
 * What kind of work a row is, at a glance. The status glyph says whether it
 * finished; this says what it was, so a list of rows can be skimmed without
 * reading every label.
 */
function StepIcon({ id }: { id: string; }) {
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
    messages: workspaceMessages,
    git,
    hasOlderMessages,
    loadingOlder,
    loadOlderMessages,
    agents,
    agentId,
    activeRun: workspaceActiveRun,
    harnesses,
    contextUsage,
    steps,
    events: workspaceEvents,
    pendingApproval,
    api,
    notice,
    ready,
    runs: workspaceRuns,
    setNotice,
    createTask,
    createProjectFromFolder,
    pickProjectDirectory,
    connected,
    settings,
    openPath,
    terminalOpen,
    view,
    setTerminalOpen,
    setInspectorOpen,
    setInspectorTab,
    gitDiscard,
    setConfirm,
  } = useWorkspace();

  // Selection changes before asynchronous history loads finish. Never render
  // a previous repository's outcomes while waiting for the next thread.
  const messages = useMemo(() => workspaceMessages.filter((message) => message.sessionId === session?.id), [workspaceMessages, session?.id]);
  const runs = useMemo(() => workspaceRuns.filter((run) => run.sessionId === session?.id && run.projectId === project?.id), [workspaceRuns, session?.id, project?.id]);
  const events = useMemo(() => {
    const ids = new Set(runs.map((run) => run.id));
    return workspaceEvents.filter((event) => ids.has(event.runId));
  }, [workspaceEvents, runs]);
  const activeRun = workspaceActiveRun?.sessionId === session?.id && workspaceActiveRun?.projectId === project?.id ? workspaceActiveRun : undefined;

  const discardFile = useCallback(
    (filePath: string) => {
      setConfirm({
        title: "Discard changes?",
        detail: `${filePath} will be reverted to its last committed state. This cannot be undone.`,
        danger: true,
        confirmLabel: "Discard",
        onConfirm: () => {
          void gitDiscard(filePath);
          setConfirm(undefined);
        },
      });
    },
    [setConfirm, gitDiscard],
  );

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
  const visibleMessageCount = useMemo(() => turns.reduce((count, turn) => count + turn.messages.length, 0), [turns]);
  const turnOutcomes = useMemo(() => outcomesByTurn(turns, runs, session?.id, project?.id), [turns, runs, session?.id, project?.id]);
  // The newest work log is rendered below the messages. Keep its receipt
  // below it too, while older receipts remain attached to their own turn.
  const lastTurn = turns.at(-1);
  const footerVerification = !activeRun && steps.length > 0 && lastTurn
    ? turnOutcomes.get(lastTurn.id)?.find((run) => run.status === "completed" && events.some((event) => event.runId === run.id))
    : undefined;

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

  // In-flight activity may show only this run's evidence. Saved outcomes have
  // their own per-run loader below the originating reply.
  const touchedFiles = useMemo(() => activeRun
    ? extractTouchedFiles(events.filter((event) => event.runId === activeRun.id), undefined, terminalCwd).filter((file) => file.action !== "read")
    : [], [events, activeRun?.id, terminalCwd]);

  /*
   * What the turn is doing, right now.
   *
   * A step once there is one. Before that there is a real wait — starting the
   * agent can take seconds — and the lifecycle events carry the only account
   * of it, so the line says "Starting Claude Code" rather than sitting blank
   * with a spinner.
   */
  const liveActivity = useMemo(() => {
    const step = steps.at(-1)?.label;
    if (step) return step;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.data?.step !== "harness") continue;
      const message = event.message?.trim();
      if (message) return message;
    }
    return undefined;
  }, [events, steps]);

  // A failed run owns its error; the send rejection is only a fallback until
  // that run arrives. Remember dismissals per attempt, not per error string.
  const [dismissedFailures, setDismissedFailures] = useState<ReadonlySet<string>>(() => new Set());
  const { notice: shownNotice, failure, failureKey } = threadFeedback({ sessionId: session?.id, runs, notice, dismissed: dismissedFailures });

  const openTurn = useCallback((id: string) => {
    setOpenedTurns((current) => new Set(current).add(id));
  }, []);
  const openAttachment = useCallback((path: string) => void openPath(path), [openPath]);

  const scroller = useRef<HTMLDivElement>(null);
  /* Track the message count at mount time so entrance animations only fire for
     messages that arrive after the initial load, not the whole history. */
  const initialCountRef = useRef(visibleMessageCount);
  const [stick, setStick] = useState(true);

  useEffect(() => {
    if (!stick) return;
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, activeRun, stick]);

  return (
    <section className={`main page-content${ready && visibleMessageCount === 0 ? " conversation-empty" : ""}`}>
      {shownNotice && (
        <div className="notice notice-dismissable" role="status">
          <span>{shownNotice}</span>
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
          ) : visibleMessageCount === 0 ? (
            <div className="empty-thread">
              {/*
                * The mark, above the question. An empty thread was the one
                * screen in the app that carried no sign of what it belonged
                * to; the icon is the same one the About panel and the Dock
                * use, so it reads as Capsule rather than as decoration.
                */}
              <span className="empty-thread-mark" aria-hidden />
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
                  <Fragment key={turn.id}>
                  {turn.messages.map((message, messageIndex) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      isNew={(turnOffsets.get(turn.id) ?? 0) + messageIndex >= initialCountRef.current}
                      onOpenAttachment={openAttachment}
                    />
                  ))}
                    {(turnOutcomes.get(turn.id) ?? []).map((run) => <Fragment key={run.id}>
                      {run.status === "completed" && !run.result?.trim() && !turn.messages.some((message) => message.role === "assistant") && <p className="muted turn-missing-reply" role="status">No reply was received for this turn. Review the work log before retrying.</p>}
                      <TurnOutcome run={run} cwd={terminalCwd} />
                      {run.id !== footerVerification?.id && <TurnVerification run={run} />}
                    </Fragment>)}
                  </Fragment>
                ),
              )}
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
                <TurnStatusLine
                  run={activeRun}
                  agentId={session?.harnessId ?? session?.agentId}
                  agentName={harnessDisplayName(
                    harnesses,
                    session?.harnessId,
                    agents.find((item) => item.id === agentId)?.name ?? "the agent",
                  )}
                  usage={contextUsage}
                  activity={liveActivity}
                />
              ) : null}
              <RunSummary
                label={summariseWork(steps).label}
                isComplete={!activeRun}
                touchedFiles={touchedFiles}
                onOpenFile={openAttachment}
              >
                {touchedFiles.length > 0 && (
                  <TurnFilesCard
                    files={touchedFiles}
                    onOpenFile={openAttachment}
                    onOpenDiff={() => {
                      setInspectorTab("diff");
                      setInspectorOpen(true);
                    }}
                    onDiscardFile={discardFile}
                  />
                )}
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
          {/* Last in the thread: the outcome of the newest turn, under the
              record of what that turn did. Above the work log it read as a
              verdict on the turn before it. */}
          {footerVerification && <TurnVerification key={footerVerification.id} run={footerVerification} />}
          {failure && failureKey ? (
            <div className="thread-error" role="status">
              <AlertTriangleIcon size={13} aria-hidden />
              <span className="thread-error-text" title={failure}>
                {failure}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Dismiss error"
                onClick={() => {
                  setDismissedFailures((current) => new Set(current).add(failureKey));
                  if (notice && !shownNotice) setNotice(undefined);
                }}
              >
                <XIcon size={12} />
              </button>
            </div>
          ) : null}
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
                  onClick={() => void api.resolveApproval(pendingApproval.id, "approved_once").catch((error) => setNotice(formatUserError(error)))}
                >
                  Approve once
                </button>
                <button
                  className="chip"
                  disabled={session?.openclawSessionKey?.startsWith("direct:acp:")}
                  title={session?.openclawSessionKey?.startsWith("direct:acp:") ? "Direct agents support approval once here." : undefined}
                  onClick={() => void api.resolveApproval(pendingApproval.id, "approved_session").catch((error) => setNotice(formatUserError(error)))}
                >
                  Approve session
                </button>
                <button
                  className="ghost"
                  onClick={() => void api.resolveApproval(pendingApproval.id, "denied").catch((error) => setNotice(formatUserError(error)))}
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
      <ViewErrorBoundary compact label="Terminal">
        <PersistentTerminals cwd={terminalCwd} visible={terminalOpen && view === "chat"} onClose={() => setTerminalOpen(false)} />
      </ViewErrorBoundary>
    </section>
  );
}
