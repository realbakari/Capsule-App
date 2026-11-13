import { useEffect, useState } from "react";
import type { ProjectActionRun } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { RunElapsed } from "../conversation/RunElapsed";
import { ChevronRightIcon, StopIcon, TerminalIcon } from "./icons";

const OUTPUT_LINES = 12;
const POLL_MS = 1500;

interface Task {
  key: string;
  label: string;
  startedAt: string;
  stopping: boolean;
  output?: string;
  stop: () => Promise<void>;
}

/**
 * What is running for this conversation: the turn in flight and any project
 * action (a dev server, a watcher). Each row counts its own time, opens to
 * show its latest output, and can be stopped from here.
 */
export function BackgroundTasks() {
  const { api, project, session, activeRun, runs, stopRun, setNotice } = useWorkspace();
  const [actionRuns, setActionRuns] = useState<ProjectActionRun[]>([]);
  const [open, setOpen] = useState<string>();

  useEffect(() => {
    if (!project?.id) { setActionRuns([]); return undefined; }
    let disposed = false;
    const refresh = () => {
      void api.listProjectActionRuns(project.id, session?.id)
        .then((next) => { if (!disposed) setActionRuns(next as ProjectActionRun[]); })
        .catch(() => { /* Keep the last reading; the row says nothing new rather than flicker. */ });
    };
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => { disposed = true; window.clearInterval(id); };
  }, [api, project?.id, session?.id]);

  const names = new Map((project?.actions ?? []).map((action) => [action.id, action.name]));
  const tasks: Task[] = [];
  if (activeRun) {
    tasks.push({
      key: `turn:${activeRun.id}`,
      label: activeRun.prompt?.split("\n")[0]?.slice(0, 120) || "This turn",
      startedAt: activeRun.createdAt,
      stopping: false,
      stop: stopRun,
    });
  }
  for (const run of actionRuns) {
    if (run.status !== "running" && run.status !== "stopping") continue;
    tasks.push({
      key: `action:${run.actionId}`,
      label: names.get(run.actionId) ?? "Project action",
      startedAt: run.startedAt,
      stopping: run.status === "stopping",
      output: run.output,
      stop: async () => {
        if (!project) return;
        const next = (await api.stopProjectAction(project.id, run.actionId, session?.id)) as ProjectActionRun;
        setActionRuns((current) => current.map((item) => (item.actionId === next.actionId ? next : item)));
      },
    });
  }
  const finished = runs.filter((run) => run.sessionId === session?.id && run.completedAt).length
    + actionRuns.filter((run) => run.status !== "running" && run.status !== "stopping").length;

  return (
    <section className="background-tasks">
      <h4>Background tasks</h4>
      {tasks.length === 0 ? <p className="session-details-row faint">Nothing running</p> : null}
      {tasks.map((task) => {
        const expanded = open === task.key;
        const lines = task.output?.trimEnd().split("\n").slice(-OUTPUT_LINES).join("\n");
        return (
          <div className="background-task" key={task.key} data-open={expanded || undefined}>
            <div className="background-task-row">
              <button type="button" className="background-task-toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? undefined : task.key)}>
                <ChevronRightIcon size={12} />
                <TerminalIcon size={14} />
                <span className="truncate">{task.label}</span>
                <RunElapsed startedAt={task.startedAt} className="background-task-time" />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={task.stopping ? "Stopping…" : `Stop ${task.label}`}
                aria-label={`Stop ${task.label}`}
                disabled={task.stopping}
                onClick={() => void task.stop().catch((error) => setNotice(formatUserError(error)))}
              >
                <StopIcon size={12} />
              </button>
            </div>
            {expanded ? (
              task.key.startsWith("turn:")
                ? <p className="background-task-output faint">The turn’s steps are in the conversation.</p>
                : <pre className="background-task-output">{lines || "No output yet"}</pre>
            ) : null}
          </div>
        );
      })}
      {finished > 0 && <p className="session-details-row faint">{finished} finished</p>}
    </section>
  );
}
