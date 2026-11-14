import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { groupBoardCards, type BoardCard, type BoardCardOp, type BoardContext, type Run, type Session } from "@capsule/shared";

import { useWorkspace } from "../../lib/workspace";
import { compactRelativeTime, formatWorkingDurationLabel, isWorkingHarnessState, latestSidebarRuns } from "../../lib/sidebar";
import {
  BOARD_SCOPE_KEY,
  NEW_BOARD_CARD_EVENT,
  latestStep,
  moveBoardFocus,
  promptPreview,
  readBoardScope,
  takeNewBoardCardRequest,
  type BoardKey,
  type BoardScope,
} from "../../lib/board";
import { formatUserError } from "../../lib/errors";
import { floatingPlacement } from "../../lib/floating-placement";
import { AgentGlyph } from "../shell/AgentGlyph";
import { CheckIcon, GitBranchIcon, LinkIcon, PlayIcon, PlusIcon, SparkIcon, UndoIcon, XIcon } from "../shell/icons";
import { NewCardDialog } from "./NewCardDialog";
import { AgentTasksSetting } from "./AgentTasksSetting";
import "./board.css";

const STEP_COLUMNS = new Set(["running", "needs-you", "review"]);
const STEP_LIMIT = 40;

/**
 * Threads as cards in status columns. A view over the same threads the
 * sidebar lists: nothing here is stored apart from them.
 */
export function BoardView() {
  const { api, projects, projectId, sessions, projectRuns, harnesses, setProjectId, setView } = useWorkspace();
  const canEdit = api.isDesktop !== false;
  const [scope, setScope] = useState<BoardScope>(() => readBoardScope(() => localStorage.getItem(BOARD_SCOPE_KEY)));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [linkFrom, setLinkFrom] = useState<string>();
  const [menuFor, setMenuFor] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  const latestRuns = useMemo(() => latestSidebarRuns(projectRuns), [projectRuns]);
  const context = useMemo<BoardContext>(() => ({
    sessions: new Map(sessions.map((session) => [session.id, session])),
    latestRuns,
    isWorking: (session) => isWorkingHarnessState(session.harnessState),
  }), [sessions, latestRuns]);
  const project = projects.find((item) => item.id === projectId);
  const scoped = scope === "all" || !project;
  const projectNames = useMemo(() => new Map(projects.map((item) => [item.id, item.name])), [projects]);
  const columns = useMemo(() => groupBoardCards(
    sessions.filter((session) => projectNames.has(session.projectId) && (scoped || session.projectId === projectId)),
    context,
  ), [sessions, projectNames, scoped, projectId, context]);
  const cards = useMemo(() => columns.flatMap((column) => column.cards), [columns]);
  // One tab stop for the whole board; arrow keys move between cards from there.
  const tabStop = focused && cards.some((card) => card.session.id === focused) ? focused : cards[0]?.session.id;
  const steps = useLatestSteps(api, cards, latestRuns);

  useEffect(() => {
    const open = () => { if (takeNewBoardCardRequest() && canEdit) setCreating(true); };
    open();
    window.addEventListener(NEW_BOARD_CARD_EVENT, open);
    return () => window.removeEventListener(NEW_BOARD_CARD_EVENT, open);
  }, [canEdit]);

  const anyRunning = columns.some((column) => column.id === "running" && column.cards.length > 0);
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyRunning]);

  useEffect(() => {
    if (!linkFrom) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") setLinkFrom(undefined); };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [linkFrom]);

  function changeScope(next: BoardScope) {
    setScope(next);
    try { localStorage.setItem(BOARD_SCOPE_KEY, next); }
    catch { /* The scope still applies for this visit when storage is denied. */ }
  }

  async function act(sessionId: string, op: BoardCardOp) {
    setError(undefined);
    try { await api.updateBoardCard(sessionId, op); }
    catch (caught) { setError(formatUserError(caught)); }
  }

  function open(session: Session) {
    setProjectId(session.projectId, session.id);
    setView("chat");
  }

  function clickCard(card: BoardCard, event: ReactMouseEvent) {
    if ((event.target as HTMLElement).closest("button, [role=menu]")) return;
    if (canEdit && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!linkFrom) { setLinkFrom(card.session.id); return; }
      if (linkFrom === card.session.id) { setLinkFrom(undefined); return; }
      const first = linkFrom;
      setLinkFrom(undefined);
      if (!card.session.pendingStart) {
        setError(`“${card.session.title}” has already started, so it cannot wait for another card.`);
        return;
      }
      void act(card.session.id, { type: "link", dependsOn: first });
      return;
    }
    open(card.session);
  }

  function keyCard(card: BoardCard, event: ReactKeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open(card.session);
      return;
    }
    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const next = moveBoardFocus(columns.map((column) => column.cards.map((item) => item.session.id)), card.session.id, event.key as BoardKey);
      if (next) cardRefs.current.get(next)?.focus();
    }
  }

  const titleOf = (id: string) => context.sessions.get(id)?.title ?? "a removed card";
  const linkFromTitle = linkFrom ? titleOf(linkFrom) : undefined;

  return (
    <section className="panel board-page" aria-label="Board">
      <div className="board-toolbar">
        <div className="board-scope" role="radiogroup" aria-label="Which cards to show">
          <button type="button" role="radio" aria-checked={!scoped} disabled={!project} className={!scoped ? "active" : ""} onClick={() => changeScope("project")}>
            {project?.name ?? "This project"}
          </button>
          <button type="button" role="radio" aria-checked={scoped} className={scoped ? "active" : ""} onClick={() => changeScope("all")}>
            All projects
          </button>
        </div>
        {canEdit && project && !scoped && <AgentTasksSetting project={project} />}
        {canEdit ? (
          <button type="button" className="chip board-new" onClick={() => setCreating(true)} disabled={!project && projects.length === 0}>
            <PlusIcon size={13} /> New card
          </button>
        ) : <span className="board-readonly">Read only on this device</span>}
      </div>
      {linkFromTitle && (
        <div className="board-banner" role="status">
          <LinkIcon size={13} />
          <span>⌘-click the card that should start after “{linkFromTitle}”.</span>
          <button type="button" className="ghost" onClick={() => setLinkFrom(undefined)}>Cancel</button>
        </div>
      )}
      {error && (
        <div className="board-banner error" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setError(undefined)}><XIcon size={12} /></button>
        </div>
      )}
      {cards.length === 0 ? (
        <div className="board-empty">
          <p>No cards {scoped ? "yet" : `in ${project?.name ?? "this project"} yet`}.</p>
          <p className="muted">A card is a conversation. Write its prompt now, start it later, or chain it after another card.</p>
          {canEdit && <button type="button" className="chip" onClick={() => setCreating(true)} disabled={projects.length === 0}><PlusIcon size={13} /> New card</button>}
        </div>
      ) : (
        <div className="board-columns">
          {columns.map((column) => (
            <section key={column.id} className={`board-column column-${column.id}`} aria-label={`${column.label}, ${column.cards.length}`}>
              <header>
                <h2>{column.label}</h2>
                <span className="board-count">{column.cards.length}</span>
                {column.id === "draft" && canEdit && (
                  <button type="button" className="icon-btn" aria-label="New card" title="New card" onClick={() => setCreating(true)}><PlusIcon size={13} /></button>
                )}
              </header>
              <div className="board-cards">
                {column.cards.map((card) => (
                  <Card
                    key={card.session.id}
                    card={card}
                    register={(node) => { if (node) cardRefs.current.set(card.session.id, node); else cardRefs.current.delete(card.session.id); }}
                    tabStop={tabStop === card.session.id}
                    onFocus={() => setFocused(card.session.id)}
                    linking={linkFrom === card.session.id}
                    canEdit={canEdit}
                    run={latestRuns.get(card.session.id)}
                    step={steps.get(card.session.id)}
                    project={scoped ? projectNames.get(card.session.projectId) : undefined}
                    agentName={harnesses.find((item) => item.id === (card.session.harnessId ?? card.session.agentId))?.name ?? card.session.agentId}
                    now={now}
                    titleOf={titleOf}
                    menuOpen={menuFor === card.session.id}
                    setMenuOpen={(open) => setMenuFor(open ? card.session.id : undefined)}
                    candidates={cards.filter((item) => item.session.id !== card.session.id && item.session.projectId === card.session.projectId)}
                    onClick={(event) => clickCard(card, event)}
                    onKeyDown={(event) => keyCard(card, event)}
                    act={(op) => act(card.session.id, op)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {creating && (
        <NewCardDialog
          projectId={project?.id ?? projects[0]?.id ?? ""}
          cards={cards}
          onClose={() => setCreating(false)}
        />
      )}
    </section>
  );
}

function Card({
  card, register, tabStop, onFocus, linking, canEdit, run, step, project, agentName, now, titleOf,
  menuOpen, setMenuOpen, candidates, onClick, onKeyDown, act,
}: {
  card: BoardCard;
  register: (node: HTMLDivElement | null) => void;
  tabStop: boolean;
  onFocus: () => void;
  linking: boolean;
  canEdit: boolean;
  run?: Run;
  step?: string;
  project?: string;
  agentName: string;
  now: number;
  titleOf: (id: string) => string;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  candidates: BoardCard[];
  onClick: (event: ReactMouseEvent) => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
  act: (op: BoardCardOp) => Promise<void>;
}) {
  const { session, state } = card;
  const pending = session.pendingStart;
  const branch = session.workspaceMode === "worktree" ? session.worktreeBranch ?? "worktree" : undefined;
  const elapsed = state.column === "running" && run
    ? formatWorkingDurationLabel(now - Date.parse(run.createdAt))
    : compactRelativeTime(session.updatedAt, now);
  const preview = pending ? promptPreview(pending.prompt) : step;
  // A title taken from the prompt would only repeat itself.
  const line = preview === session.title ? undefined : preview;
  const waitsFor = pending?.dependsOn ?? [];
  const menuAnchor = useRef<HTMLButtonElement>(null);

  return (
    <div
      ref={register}
      role="button"
      tabIndex={tabStop ? 0 : -1}
      data-card={session.id}
      data-column={state.column}
      className={`board-card${linking ? " linking" : ""}${state.column === "needs-you" ? " needs-you" : ""}`}
      aria-label={`${session.title}, ${state.column === "needs-you" ? "needs you" : state.column}`}
      onFocus={onFocus}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className="board-card-title">
        <AgentGlyph id={session.harnessId ?? session.agentId} name={agentName} size={13} />
        <span>{session.title}</span>
      </div>
      <div className="board-card-meta">
        {branch ? <span className="board-badge" title={`Own worktree on ${branch}`}><GitBranchIcon size={11} /><span>{branch}</span></span>
          : <span className="board-badge quiet">Local</span>}
        {project && <span className="board-badge quiet"><span>{project}</span></span>}
        <time className="board-elapsed" dateTime={state.column === "running" && run ? run.createdAt : session.updatedAt}>{elapsed}</time>
      </div>
      {line ? <p className="board-card-step" title={line}>{line}</p>
        : !pending && STEP_COLUMNS.has(state.column) && step === undefined ? <p className="board-card-step loading" aria-label="Loading the latest step"><span className="skeleton skeleton-line medium" /></p> : null}
      {state.column === "needs-you" && (
        <p className="board-card-alert">
          {state.reason === "approval" ? "Waiting for your approval"
            : state.reason === "failed" ? `Failed${run?.error ? `: ${run.error.split("\n")[0]}` : ""}`
            : `Blocked by ${state.blockedBy.map((item) => `${item.title} (${item.status === "failed" ? "failed" : "stopped"})`).join(", ")}`}
        </p>
      )}
      {pending?.error && <p className="board-card-alert">Did not start: {pending.error}</p>}
      {session.origin?.kind === "task" && <p className="board-card-origin" title={`Created by an agent in ${titleOf(session.origin.sessionId)}`}><SparkIcon size={11} /><span>Created by {titleOf(session.origin.sessionId)}</span></p>}
      {waitsFor.length > 0 && !(state.column === "needs-you" && state.reason === "blocked") && (
        <p className="board-card-after">
          <LinkIcon size={11} />
          <span>After {waitsFor.map(titleOf).join(", ")}</span>
          {pending && !pending.autoStart && <small>· starts by hand</small>}
        </p>
      )}
      {canEdit && (
        <div className="board-card-actions">
          {pending && (
            <button type="button" className="chip" onClick={() => void act({ type: "start" })}>
              <PlayIcon size={11} /> {state.column === "needs-you" ? "Start anyway" : "Start"}
            </button>
          )}
          {pending && (
            <span className="board-link-menu">
              <button ref={menuAnchor} type="button" className="chip quiet" title="Depends on" aria-label="Depends on" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
                <LinkIcon size={11} /><span>Depends on</span>
              </button>
              {menuOpen && (
                <DependsOnMenu
                  anchor={menuAnchor}
                  card={card}
                  candidates={candidates}
                  onClose={() => setMenuOpen(false)}
                  toggle={(id, linked) => act(linked ? { type: "unlink", dependsOn: id } : { type: "link", dependsOn: id })}
                  setAutoStart={(autoStart) => act({ type: "edit", autoStart })}
                />
              )}
            </span>
          )}
          {(state.column === "review" || (state.column === "needs-you" && !pending && state.reason === "failed")) && (
            <button type="button" className="chip" onClick={() => void act({ type: "done" })}><CheckIcon size={11} /> Mark done</button>
          )}
          {state.column === "done" && (
            <button type="button" className="chip quiet" onClick={() => void act({ type: "reopen" })}><UndoIcon size={11} /> Reopen</button>
          )}
        </div>
      )}
    </div>
  );
}

/* In a portal: the column scrolls, and a menu inside it would be cut off at its edge. */
function DependsOnMenu({ anchor, card, candidates, onClose, toggle, setAutoStart }: {
  anchor: RefObject<HTMLButtonElement | null>;
  card: BoardCard;
  candidates: BoardCard[];
  onClose: () => void;
  toggle: (id: string, linked: boolean) => Promise<void>;
  setAutoStart: (autoStart: boolean) => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number }>();
  const linked = new Set(card.session.pendingStart?.dependsOn ?? []);
  useLayoutEffect(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const size = { width: ref.current?.offsetWidth ?? 192, height: ref.current?.scrollHeight ?? 224 };
    const next = floatingPlacement(rect, size, { width: window.innerWidth, height: window.innerHeight }, { maxHeight: 224 });
    setPosition({ left: next.left, top: next.top, maxHeight: next.maxHeight });
  }, [anchor, candidates.length]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close.current();
      anchor.current?.focus();
    };
    const dismiss = () => close.current();
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [anchor]);
  return createPortal(
    <div ref={ref} className="board-menu" role="menu" style={position ?? { visibility: "hidden" }} aria-label={`What “${card.session.title}” waits for`}>
      {candidates.length === 0 ? <p className="muted">No other cards in this project.</p> : <div className="board-menu-list">{candidates.map((item) => (
        <button
          key={item.session.id}
          type="button"
          role="menuitemcheckbox"
          aria-checked={linked.has(item.session.id)}
          onClick={() => void toggle(item.session.id, linked.has(item.session.id))}
        >
          <span className="board-menu-check">{linked.has(item.session.id) ? <CheckIcon size={11} /> : null}</span>
          <span>{item.session.title}</span>
        </button>
      ))}</div>}
      {linked.size > 0 && (
        <>
          <div className="board-menu-separator" role="separator" />
          <button type="button" role="menuitemcheckbox" aria-checked={card.session.pendingStart?.autoStart === true}
            onClick={() => void setAutoStart(!card.session.pendingStart?.autoStart)}>
            <span className="board-menu-check">{card.session.pendingStart?.autoStart ? <CheckIcon size={11} /> : null}</span>
            <span>Start on its own when these are done</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

/** The newest step of each card that has done something, read from its run's events. */
function useLatestSteps(api: typeof window.capsule, cards: BoardCard[], latestRuns: ReadonlyMap<string, Run>): Map<string, string> {
  const [steps, setSteps] = useState(() => new Map<string, string>());
  const loaded = useRef(new Map<string, string>());
  const wanted = useMemo(() => cards
    .filter((card) => STEP_COLUMNS.has(card.state.column) && latestRuns.has(card.session.id))
    .slice(0, STEP_LIMIT)
    .map((card) => ({ sessionId: card.session.id, run: latestRuns.get(card.session.id)! })), [cards, latestRuns]);
  const [tick, setTick] = useState(0);
  const anyRunning = wanted.some(({ run }) => run.status === "running" || run.status === "queued" || run.status === "waiting");
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => setTick((value) => value + 1), 4000);
    return () => clearInterval(timer);
  }, [anyRunning]);
  useEffect(() => {
    for (const { sessionId, run } of wanted) {
      const running = run.status === "running" || run.status === "queued" || run.status === "waiting";
      const key = `${run.id}:${run.updatedAt}:${running ? tick : "settled"}`;
      if (loaded.current.get(sessionId) === key) continue;
      loaded.current.set(sessionId, key);
      void api.listRunEventPage(run.id).then((page) => {
        const step = latestStep(page.events, !running) ?? (run.status === "completed" ? "Finished" : "");
        setSteps((current) => current.get(sessionId) === step ? current : new Map(current).set(sessionId, step));
      }).catch(() => { loaded.current.delete(sessionId); });
    }
  }, [api, wanted, tick]);
  return steps;
}
