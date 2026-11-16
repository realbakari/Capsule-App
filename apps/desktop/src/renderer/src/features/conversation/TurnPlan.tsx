import { taskProgress, type RunTask } from "@capsule/shared";

/**
 * A step's state as a drawn mark, one shape per state so it reads without
 * colour: a filled circle with a check when done, a ring with three dots while
 * in progress, a dashed ring while waiting.
 */
export function PlanMark({ status, size = 14 }: { status: RunTask["status"]; size?: number }) {
  return (
    <svg className={`plan-mark is-${status}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      {status === "completed" ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="m5 8.2 2 2 4-4.2" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : status === "inProgress" ? (
        <>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="5.3" cy="8" r="0.9" fill="currentColor" />
          <circle cx="8" cy="8" r="0.9" fill="currentColor" />
          <circle cx="10.7" cy="8" r="0.9" fill="currentColor" />
        </>
      ) : (
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.2 2.1" />
      )}
    </svg>
  );
}

/**
 * The plan a finished turn ended with, kept in the transcript under its
 * prompt. While a turn runs, the composer's task list is the live view, so
 * this shows only once the turn has settled.
 */
export function TurnPlan({ tasks }: { tasks: readonly RunTask[] }) {
  if (tasks.length === 0) return null;
  const { completedSteps, totalSteps } = taskProgress(tasks);
  return (
    <section className="turn-plan" aria-label={`Plan: ${completedSteps} of ${totalSteps} done`}>
      <p className="turn-plan-head">
        <span>Plan</span>
        <span className="turn-plan-count">{completedSteps} of {totalSteps} done</span>
      </p>
      <ol className="turn-plan-list">
        {tasks.map((task, index) => (
          <li key={`${task.id}:${index}`} className={`turn-plan-item is-${task.status}`}>
            <PlanMark status={task.status} />
            <span>{task.content}</span>
            {task.status === "inProgress" ? <span className="sr-only">(stopped before it finished)</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
