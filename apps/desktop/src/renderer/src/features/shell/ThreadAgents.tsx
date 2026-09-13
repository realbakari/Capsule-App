import { useEffect, useMemo, useState } from "react";
import { boundRunEvents, delegatedTasks, runActivityLabel, harnessCapabilities, sanitizeUntrusted, type RunEvent, type DelegatedTask } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { CpuIcon } from "./icons";
import { AgentGlyph } from "./AgentGlyph";

function taskStatusLabel(task: DelegatedTask, turnActive: boolean): string {
  const labels = {
    running: "Tool running",
    pending: "Tool pending",
    completed: task.background ? "Launch completed · child status unknown" : "Tool completed",
    failed: "Tool failed",
    unknown: "Status not reported",
  };
  // A completed parent turn does not prove that a background child stopped.
  const historical = !turnActive && (task.status === "running" || task.status === "pending");
  return `${historical ? "Last reported · " : ""}${labels[task.status]}`;
}

function DelegatedTaskCard({ task, turnActive }: { task: DelegatedTask; turnActive: boolean }) {
  const usage = task.totalTokens === undefined ? "Tokens not reported" : `${task.totalTokens.toLocaleString()} reported tokens`;
  return (
    <section className="thread-agent-card" aria-label="Delegated task">
      <div className="thread-agent-heading"><strong title={task.title}>{task.title}</strong></div>
      <div className="thread-agent-status">{taskStatusLabel(task, turnActive)}</div>
      <p className="truncate" title={task.activity}>{task.activity ?? "Activity not reported"}</p>
      <div className="meta">{[task.role, task.model, usage].filter(Boolean).join(" · ")}</div>
    </section>
  );
}

export function ThreadAgents() {
  const {
    api, session, projectId, runs, activeRun, events: liveEvents, eventLoad, loadSession,
    setNotice, harnesses, agents, stoppingRunIds, setView,
  } = useWorkspace();
  const candidates = [...new Map([activeRun, ...runs].filter((item) => item && item.sessionId === session?.id && item.projectId === projectId).map((item) => [item!.id, item!])).values()];
  const [selected, setSelected] = useState<{ thread: string; id: string }>();
  const [retry, setRetry] = useState(0);
  const run = (selected?.thread === session?.id ? candidates.find((item) => item.id === selected?.id) : undefined) ?? candidates[0];
  const historical = Boolean(run && run.id !== candidates[0]?.id);
  const historyKey = JSON.stringify([projectId, session?.id, historical ? run?.id : undefined]);
  const [history, setHistory] = useState<{ key: string; events: RunEvent[]; state: "loading" | "loaded" | "error"; detail?: string; partial?: boolean }>();
  useEffect(() => {
    if (!historical || !run) return;
    let current = true;
    setHistory({ key: historyKey, events: [], state: "loading" });
    void api.listRunEventPage(run.id).then((page) => {
      if (!current) return;
      const events = boundRunEvents(page.events.filter((event) => event.runId === run.id && (!event.sessionId || event.sessionId === run.sessionId)));
      setHistory({ key: historyKey, events, state: "loaded", partial: page.hasMore || events.length < page.events.length });
    }).catch((error) => { if (current) setHistory({ key: historyKey, events: [], state: "error", detail: formatUserError(error) }); });
    return () => { current = false; };
  }, [api, historyKey, historical, run?.id, retry]);
  const currentHistory = history?.key === historyKey ? history : undefined;
  const events = historical ? currentHistory?.events ?? [] : liveEvents;
  const tasks = useMemo(() => run ? delegatedTasks(run, events) : [], [run, events]);
  const harness = harnesses.find((item) => item.id === session?.harnessId);
  const route = session?.openclawSessionKey
    ? session.openclawSessionKey.startsWith("direct:acp:") ? "direct" : "openclaw"
    : session?.harnessState === "closed" ? undefined : harnessCapabilities({ harness, session }).route;
  const report = historical ? currentHistory ?? { state: "loading", detail: undefined } : eventLoad?.runId === run?.id ? eventLoad : undefined;
  const name = harness?.name ?? agents.find((item) => item.id === run?.agentId)?.name ?? run?.agentId ?? "Agent";
  const active = !historical && Boolean(run && ["running", "queued", "waiting", "approval_required"].includes(run.status));
  const activity = useMemo(() => {
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]!;
      if (event.runId !== run?.id || (event.sessionId && event.sessionId !== session?.id)) continue;
      if (event.type === "tool" && event.message) {
        return sanitizeUntrusted(event.message, { maxChars: 160, singleLine: true });
      }
    }
    return undefined;
  }, [events, run?.id, session?.id]);
  const earlier = currentHistory?.partial || events.some((event) => event.runId === run?.id && event.data?.earlierEvents);
  const emptyHeading = report?.state === "loading" ? "Loading activity…"
    : report?.state === "error" ? "Activity unavailable" : "No delegated tasks reported";

  function retryActivity() {
    if (historical) { setRetry((value) => value + 1); return; }
    if (session) void loadSession(session.id).catch((error) => setNotice(formatUserError(error)));
  }

  return (
    <div className="thread-agents">
      <header className="thread-agents-header">
        <h3>Activity</h3>
        {route && <span className="meta">{route === "direct" ? "Direct" : "Gateway"}</span>}
      </header>
      {candidates.length > 1 && <label className="meta">Turn
        <select aria-label="Agent activity turn" value={historical ? run?.id : "latest"} onChange={(event) => setSelected(event.target.value === "latest" ? undefined : { thread: session!.id, id: event.target.value })}>
          <option value="latest">Latest turn</option>
          {candidates.slice(1).map((item) => <option key={item.id} value={item.id}>{sanitizeUntrusted(item.prompt ?? "Turn", { maxChars: 80, singleLine: true })}</option>)}
        </select>
      </label>}
      {run && (
        <section className="thread-agent-card" aria-label="Primary agent">
          <div className="thread-agent-heading">
            <AgentGlyph id={harness?.id} name={name} size={18} />
            <strong>{name}</strong>
          </div>
          <div className="thread-agent-status" data-active={active}>
            {historical ? "Recorded · " : ""}{runActivityLabel(run, stoppingRunIds?.includes(run.id))}
          </div>
          <p className="truncate" title={activity ?? run.prompt}>{activity ?? run.prompt}</p>
          <span className="meta">Primary agent · {historical ? "recorded turn" : "latest turn"}</span>
        </section>
      )}
      <div className="thread-agents-section-label">
        Delegated tasks {tasks.length > 0 && <span>{tasks.length}</span>}
      </div>
      {report?.state === "error" && (
        <p className="meta" role="alert">
          Could not load reported activity. {report.detail}
          {" "}<button type="button" className="ghost" onClick={retryActivity}>Retry</button>
        </p>
      )}
      {tasks.length === 0 ? (
        <div className="thread-agents-empty">
          <CpuIcon size={20} />
          <div>
            <h4>{emptyHeading}</h4>
            <p>{session ? "Reported tasks and their activity will appear here." : "Start a conversation to see its agent activity."}</p>
          </div>
        </div>
      ) : tasks.map((task) => <DelegatedTaskCard key={task.id} task={task} turnActive={active} />)}
      {earlier && <p className="meta" role="status">Earlier events are outside the loaded window. This is a partial task list.</p>}
      {tasks.length >= 100 && <p className="meta">Showing up to 100 delegated tasks from this turn.</p>}
      <details className="thread-agents-details">
        <summary>What this panel can show</summary>
        <p>Choose an earlier loaded turn to inspect its recorded activity. Historical reads are bounded and never replace live activity. Task states describe reported delegation tool calls, not a complete child-agent roster. Workflow membership and child-session controls are not available on these routes.</p>
        <p>Some harnesses or Gateway versions omit delegation details and per-task usage. Missing values stay unknown; usage is never estimated from text or assigned from the parent turn.</p>
      </details>
      <footer>
        <button type="button" className="ghost" onClick={() => setView("runtimes")}>Manage harnesses</button>
      </footer>
    </div>
  );
}
