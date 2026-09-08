import { useMemo } from "react";
import { delegatedTasks, runActivityLabel, harnessCapabilities, sanitizeUntrusted, type DelegatedTask } from "@capsule/shared";
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
    session, projectId, runs, activeRun, events, eventLoad, loadSession,
    setNotice, harnesses, agents, stoppingRunIds, setView,
  } = useWorkspace();
  const run = [activeRun, ...runs].find((item) => item && item.sessionId === session?.id && item.projectId === projectId);
  const tasks = useMemo(() => run ? delegatedTasks(run, events) : [], [run, events]);
  const harness = harnesses.find((item) => item.id === session?.harnessId);
  const route = session?.openclawSessionKey
    ? session.openclawSessionKey.startsWith("direct:acp:") ? "direct" : "openclaw"
    : session?.harnessState === "closed" ? undefined : harnessCapabilities({ harness, session }).route;
  const report = eventLoad?.runId === run?.id ? eventLoad : undefined;
  const name = harness?.name ?? agents.find((item) => item.id === run?.agentId)?.name ?? run?.agentId ?? "Agent";
  const active = Boolean(run && ["running", "queued", "waiting", "approval_required"].includes(run.status));
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
  const earlier = events.some((event) => event.runId === run?.id && event.data?.earlierEvents);
  const emptyHeading = report?.state === "loading" ? "Loading activity…"
    : report?.state === "error" ? "Activity unavailable" : "No delegated tasks reported";

  function retryActivity() {
    if (session) void loadSession(session.id).catch((error) => setNotice(formatUserError(error)));
  }

  return (
    <div className="thread-agents">
      <header className="thread-agents-header">
        <h3>Activity</h3>
        {route && <span className="meta">{route === "direct" ? "Direct" : "Gateway"}</span>}
      </header>
      {run && (
        <section className="thread-agent-card" aria-label="Primary agent">
          <div className="thread-agent-heading">
            <AgentGlyph id={harness?.id} name={name} size={18} />
            <strong>{name}</strong>
          </div>
          <div className="thread-agent-status" data-active={active}>
            {runActivityLabel(run, stoppingRunIds?.includes(run.id))}
          </div>
          <p className="truncate" title={activity ?? run.prompt}>{activity ?? run.prompt}</p>
          <span className="meta">Primary agent · latest turn</span>
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
        <p>Only this thread’s latest turn is shown. Task states describe reported delegation tool calls, not a complete child-agent roster. Workflow membership and child-session controls are not available on these routes.</p>
        <p>Some harnesses or Gateway versions omit delegation details and per-task usage. Missing values stay unknown; usage is never estimated from text or assigned from the parent turn.</p>
      </details>
      <footer>
        <button type="button" className="ghost" onClick={() => setView("runtimes")}>Manage harnesses</button>
      </footer>
    </div>
  );
}
