import { useEffect, useState } from "react";
import { taskProgress, type RunTask } from "@capsule/shared";
import { ChevronRightIcon, ListTodoIcon } from "../shell/icons";

const STATUS_LABEL: Record<RunTask["status"], string> = {
  pending: "Pending",
  inProgress: "Running",
  completed: "Completed",
};

export function ComposerTasks({ tasks, running = false }: { tasks: readonly RunTask[]; running?: boolean }) {
  const progress = taskProgress(tasks);
  const live = running && tasks.some((task) => task.status === "inProgress");
  const [expanded, setExpanded] = useState(live);
  useEffect(() => {
    if (live) setExpanded(true);
  }, [live]);
  if (tasks.length === 0) return null;
  const complete = progress.completedSteps >= progress.totalSteps && progress.totalSteps > 0;
  return (
    <section className="composer-tasks">
      <button
        type="button"
        className="composer-tasks-toggle"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse tasks" : "Tasks"}: ${progress.completedSteps} of ${progress.totalSteps} complete. ${running ? "Current" : "Last reported"} task: ${progress.step}`}
        onClick={() => setExpanded((value) => !value)}
      >
        <ListTodoIcon size={14} />
        <span className="faint">Tasks</span>
        <span className="composer-tasks-current">{progress.step}</span>
        <span className={`composer-tasks-count${complete ? " is-complete" : ""}`}>
          {progress.completedSteps}/{progress.totalSteps} complete
        </span>
        {tasks.length > 1 && tasks.length <= 10 ? (
          <span className="composer-tasks-segments" aria-hidden>
            {tasks.map((task, index) => (
              <span key={`${task.id}:${index}`} className={`composer-tasks-segment is-${task.status}`} />
            ))}
          </span>
        ) : null}
        <ChevronRightIcon size={13} className={expanded ? "open" : ""} />
      </button>
      {expanded ? (
        <ul className="composer-tasks-list" aria-label={`Task list. ${progress.completedSteps} of ${progress.totalSteps} complete.`}>
          {tasks.map((task, index) => (
            <li key={`${task.id}:${index}`} className={`composer-tasks-item is-${task.status}`}>
              <span className="composer-tasks-mark" aria-hidden>
                {task.status === "completed" ? "✓" : task.status === "inProgress" ? "●" : "○"}
              </span>
              <span className="composer-tasks-copy">{task.content}</span>
              <span className="faint">{task.status === "inProgress" && !running ? "Incomplete" : STATUS_LABEL[task.status]}</span>
              {task.status === "inProgress" && running ? <span className="faint">now</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
