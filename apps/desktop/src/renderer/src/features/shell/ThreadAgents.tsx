import { useMemo } from "react";
import { delegatedTasks, runActivityLabel, harnessCapabilities, sanitizeUntrusted } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { CpuIcon } from "./icons";

export function ThreadAgents() {
  const { session, projectId, runs, activeRun, events, harnesses, agents, stoppingRunIds, setView } = useWorkspace();
  const run = [activeRun, ...runs].find((item) => item && item.sessionId === session?.id && item.projectId === projectId);
  const tasks = useMemo(() => run ? delegatedTasks(run, events) : [], [run, events]);
  const harness = harnesses.find((item) => item.id === session?.harnessId);
  const route = harnessCapabilities({ harness, session }).route;
  const active = run && ["running", "queued", "waiting", "approval_required"].includes(run.status);
  const activity = useMemo(() => {
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]!;
      if (event.runId === run?.id && (!event.sessionId || event.sessionId === session?.id) && event.type === "tool" && event.message) return sanitizeUntrusted(event.message, { maxChars: 160, singleLine: true });
    }
    return undefined;
  }, [events, run?.id, session?.id]);
  const earlier = events.some((event) => event.runId === run?.id && event.data?.earlierEvents);
  return <div className="thread-agents">
    <header><h3>Thread agents</h3><span className="meta">{route === "direct" ? "Direct" : "Gateway"} route</span></header>
    {run && <section className="thread-agent-card" aria-label="Primary agent">
      <div className="thread-agent-heading"><CpuIcon size={16} /><strong>{harness?.name ?? agents.find((item) => item.id === run.agentId)?.name ?? run.agentId}</strong><span>{runActivityLabel(run, stoppingRunIds?.includes(run.id))}</span></div>
      <p className="truncate" title={activity ?? run.prompt}>{activity ?? run.prompt}</p>
      <span className="meta">Primary agent · latest turn</span>
    </section>}
    <h4>Delegated tasks {tasks.length > 0 && <span className="meta">{tasks.length}</span>}</h4>
    {tasks.length === 0 ? <div className="thread-agents-empty"><CpuIcon size={28} /><h4>No delegated tasks reported</h4><p>{session ? "Tasks appear here when the runtime reports structured delegation details. An empty list does not mean the agent has no internal subagents." : "Start a conversation to see its agent activity."}</p></div> : tasks.map((task) => <section key={task.id} className="thread-agent-card" aria-label="Delegated task">
      <div className="thread-agent-heading"><strong title={task.title}>{task.title}</strong><span>{!active && (task.status === "running" || task.status === "pending") ? "Last reported · " : ""}{({ running: "Running", pending: "Pending", completed: "Task completed", failed: "Task failed", unknown: "Status not reported" })[task.status]}</span></div>
      <p className="truncate" title={task.activity}>{task.activity ?? "Activity not reported"}</p>
      <div className="meta">{task.role}{task.model ? ` · ${task.model}` : ""} · {task.totalTokens === undefined ? "Tokens not reported" : `${task.totalTokens.toLocaleString()} reported tokens`}</div>
      {task.background && <p className="meta">Background task: tool completion does not establish child-agent completion.</p>}
    </section>)}
    {earlier && <p className="meta" role="status">Earlier events are outside the loaded window. This is a partial task list.</p>}
    {tasks.length >= 100 && <p className="meta">Showing up to 100 delegated tasks from this turn.</p>}
    <details className="thread-agents-details"><summary>What this panel can show</summary><p>Only this thread’s latest turn is shown. Task states describe reported delegation tool calls, not a complete child-agent roster. Workflow membership and child-session controls are not available on these routes.</p><p>Some harnesses or Gateway versions omit delegation details and per-task usage. Missing values stay unknown; usage is never estimated from text or assigned from the parent turn.</p></details>
    <button type="button" className="ghost" onClick={() => setView("runtimes")}>Manage harnesses</button>
  </div>;
}
