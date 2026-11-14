import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BEST_OF_N_MAX, BEST_OF_N_MIN, PRIMARY_HARNESS_IDS, type BestOfNCandidate, type HarnessReadiness, type HarnessStatus } from "@capsule/shared";
import { useAnchoredPopover } from "../../lib/anchored-popover";
import { RUN_ON_EVENT, takeRunOnRequest } from "../../lib/best-of-n";
import { isFeaturedHarness } from "../../lib/harness";
import { useWorkspace } from "../../lib/workspace";
import { AgentGlyph } from "../shell/AgentGlyph";
import { CompareIcon, PlusIcon, XIcon } from "../shell/icons";
import { useBestOfN } from "./BestOfN";
import { leaderboardHint, useLeaderboard } from "./Leaderboard";
import "./best-of-n.css";

const READY = new Set<HarnessReadiness>(["ready", "dedicated", "running"]);
const NOT_READY: Partial<Record<HarnessReadiness, string>> = {
  missing_cli: "Not installed",
  needs_login: "Needs sign-in",
  missing_acpx: "Gateway bridge missing",
  gateway_offline: "Gateway offline",
};

export interface RunOnState {
  /** Shown only for a new conversation in a Git project, on the desktop. */
  offered: boolean;
  picks: BestOfNCandidate[];
  setPicks: (picks: BestOfNCandidate[]) => void;
  /** Two or more picked: the composer's send runs the comparison. */
  active: boolean;
  starting: boolean;
  start: () => Promise<void>;
}

/** The composer's "Run on…" selection, cleared when the conversation changes. */
export function useRunOn(): RunOnState {
  const { api, projectId, session, messages, runs, git, draft, attachments } = useWorkspace();
  const { start: startComparison } = useBestOfN();
  const [picks, setPicks] = useState<BestOfNCandidate[]>([]);
  const [starting, setStarting] = useState(false);
  const offered = api.isDesktop !== false && Boolean(projectId) && git?.isRepo === true && messages.length === 0
    && !(session?.harnessState && session.harnessState !== "closed");
  useEffect(() => { setPicks([]); }, [projectId, session?.id]);
  const active = offered && picks.length >= BEST_OF_N_MIN;
  return {
    offered, picks, setPicks, active, starting,
    start: async () => {
      if (!active || !projectId || starting || (!draft.trim() && attachments.length === 0)) return;
      setStarting(true);
      try {
        const untouched = session && session.projectId === projectId && !session.pinned && !runs.some((run) => run.sessionId === session.id);
        if (await startComparison({ projectId, prompt: draft, candidates: picks, ...(untouched ? { replaceSessionId: session.id } : {}) })) setPicks([]);
      } finally { setStarting(false); }
    },
  };
}

function rowOrder(a: HarnessStatus, b: HarnessStatus): number {
  return Number(READY.has(b.readiness)) - Number(READY.has(a.readiness))
    || Number(isFeaturedHarness(b)) - Number(isFeaturedHarness(a))
    || Number(PRIMARY_HARNESS_IDS.includes(b.id)) - Number(PRIMARY_HARNESS_IDS.includes(a.id))
    || a.name.localeCompare(b.name);
}

/**
 * Pick two to four agents, each with an optional model, to receive the same
 * prompt. The same agent can be picked twice to compare two of its models.
 * An agent that cannot start says why and cannot be picked. What you kept
 * and rated before shows beside each agent as a hint.
 */
export function RunOnControl({ runOn }: { runOn: RunOnState }) {
  const { harnesses, setView, status } = useWorkspace();
  /* The test runtime answers for every agent, as the composer's own Gateway check assumes. */
  const mock = status?.kind === "mock";
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const position = useAnchoredPopover(open, anchor, panel, "start");
  const { rows } = useLeaderboard(open);
  const { offered, picks, setPicks } = runOn;

  /* The palette's "Run on several agents…" lands here once a new conversation is on screen. */
  useEffect(() => {
    if (!offered) return undefined;
    if (takeRunOnRequest()) setOpen(true);
    const request = () => { if (takeRunOnRequest()) setOpen(true); };
    window.addEventListener(RUN_ON_EVENT, request);
    return () => window.removeEventListener(RUN_ON_EVENT, request);
  }, [offered]);

  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("[data-run-on-choice]:not(:disabled), button")?.focus());
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);

  if (!offered) return null;
  function close() { setOpen(false); anchor.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
  const agents = [...(harnesses ?? [])].filter((harness) => harness.id !== "muse").sort(rowOrder);
  const nameOf = (id: string) => agents.find((agent) => agent.id === id)?.name ?? id;
  const full = picks.length >= BEST_OF_N_MAX;
  const update = (index: number, change: Partial<BestOfNCandidate>) => setPicks(picks.map((pick, at) => at === index ? { ...pick, ...change } : pick));
  const label = picks.length >= BEST_OF_N_MIN ? `Run on ${picks.length} agents` : "Run on…";

  return (
    <div className="run-on" ref={anchor}>
      <button type="button" className={`run-on-trigger${picks.length >= BEST_OF_N_MIN ? " active" : ""}`} aria-haspopup="dialog" aria-expanded={open}
        title="Send this prompt to several agents and compare what comes back" onClick={() => setOpen((value) => !value)}>
        <CompareIcon size={13} /><span>{label}</span>
      </button>
      {picks.length >= BEST_OF_N_MIN ? (
        <button type="button" className="run-on-clear" aria-label="Run on one agent instead" title="Run on one agent instead" onClick={() => setPicks([])}><XIcon size={11} /></button>
      ) : null}
      {open && createPortal(
        <div className="run-on-picker" ref={panel} style={position} role="dialog" aria-label="Run on several agents"
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            const choices = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("[data-run-on-choice]:not(:disabled)") ?? []);
            const index = choices.findIndex((choice) => choice === document.activeElement);
            if (index < 0) return;
            event.preventDefault();
            choices[(index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
          }}>
          <header>
            <strong>Run on several agents</strong>
            <span className="faint">{picks.length} of {BEST_OF_N_MAX}</span>
            <button type="button" className="icon-btn" aria-label="Close" onClick={close}><XIcon size={13} /></button>
          </header>
          <section className="run-on-picks" aria-label="Chosen agents">
            {picks.length === 0 ? <p className="run-on-empty">Pick {BEST_OF_N_MIN} to {BEST_OF_N_MAX} agents below. Each gets the same prompt in its own worktree. Pick one agent twice to compare its models.</p>
              : picks.map((pick, index) => {
                const hint = leaderboardHint(rows, pick.harnessId, pick.model ?? "");
                return (
                  <div className="run-on-pick" key={`${pick.harnessId}-${index}`}>
                    <AgentGlyph id={pick.harnessId} name={nameOf(pick.harnessId)} size={14} />
                    <span className="run-on-pick-name">{nameOf(pick.harnessId)}{hint ? <small>{hint}</small> : null}</span>
                    <input aria-label={`Model for ${nameOf(pick.harnessId)}`} placeholder="Default model" value={pick.model ?? ""}
                      spellCheck={false} onChange={(event) => update(index, { model: event.target.value || undefined })} />
                    <button type="button" className="icon-btn" aria-label={`Remove ${nameOf(pick.harnessId)}`} onClick={() => setPicks(picks.filter((_, at) => at !== index))}><XIcon size={12} /></button>
                  </div>
                );
              })}
            {picks.length === 1 ? <p className="run-on-empty">Pick one more to compare.</p> : null}
          </section>
          <section className="run-on-agents" aria-label="Agents">
            {agents.map((agent) => {
              const ready = READY.has(agent.readiness) || (mock && agent.readiness === "gateway_offline");
              const reason = !ready ? NOT_READY[agent.readiness] ?? agent.detail : full ? `At most ${BEST_OF_N_MAX} agents` : undefined;
              const hint = leaderboardHint(rows, agent.id);
              return (
                <button type="button" key={agent.id} className="run-on-agent" data-run-on-choice disabled={Boolean(reason)}
                  title={!ready ? agent.loginHint ?? agent.detail : undefined}
                  onClick={() => setPicks([...picks, { harnessId: agent.id }])}>
                  <AgentGlyph id={agent.id} name={agent.name} size={14} />
                  <span className="run-on-agent-name">{agent.name}<small>{reason ?? hint ?? (mock ? "Test runtime" : agent.runtimeRoute === "direct" ? "Runs on this computer" : "Runs through the Gateway")}</small></span>
                  {!reason ? <PlusIcon size={13} /> : null}
                </button>
              );
            })}
          </section>
          <footer>
            <button type="button" className="link-btn" onClick={() => { close(); setView("usage"); }}>Your results</button>
            <button type="button" className="send" disabled={picks.length < BEST_OF_N_MIN} onClick={close}>
              {picks.length < BEST_OF_N_MIN ? `Pick ${BEST_OF_N_MIN - picks.length} more` : "Done"}
            </button>
          </footer>
        </div>,
        document.body,
      )}
    </div>
  );
}
