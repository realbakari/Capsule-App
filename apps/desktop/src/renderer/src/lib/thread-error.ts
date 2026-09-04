import { formatUserError } from "./errors";

/*
 * The reason a turn failed, said once in the thread it happened in.
 *
 * A failed run stored its error and showed a red word in the sidebar. The
 * reason itself was only reachable by opening the raw event list, so the
 * commonest question after a failure — what went wrong — was the one thing
 * the transcript did not answer.
 */

export interface ThreadErrorInput {
  sessionId?: string;
  runs: ReadonlyArray<{
    id?: string;
    sessionId: string;
    status: string;
    error?: string;
    result?: string;
    createdAt: string;
  }>;
}

function latestThreadRun(input: ThreadErrorInput): ThreadErrorInput["runs"][number] | undefined {
  let latest: ThreadErrorInput["runs"][number] | undefined;
  for (const run of input.runs) {
    if (run.sessionId !== input.sessionId) continue;
    if (!latest || run.createdAt > latest.createdAt) latest = run;
  }
  return latest;
}

/*
 * Capsule's own contract verdicts. They are the app judging a turn against
 * the contract it wrote for itself, not the agent reporting a problem —
 * printing them in red over an answer that arrived says the wrong thing about
 * a turn that worked.
 */
const INTERNAL_VERDICTS = new Set(["verification failed", "empty result", "completed"]);

/** Whether a stored run error is one of those verdicts rather than a real fault. */
export function isInternalVerdict(message: string | undefined): boolean {
  return Boolean(message && INTERNAL_VERDICTS.has(message.trim().toLowerCase()));
}

/** What to show for this thread, if anything. */
export function threadError(input: ThreadErrorInput): string | undefined {
  if (!input.sessionId) return undefined;
  const latest = latestThreadRun(input);
  // Only the newest run: an older failure that a later turn moved past is
  // history, not the state of the conversation.
  if (!latest || (latest.status !== "failed" && latest.status !== "blocked")) return undefined;
  // A turn that answered is not a failure worth shouting about, whatever a
  // later check decided.
  if (latest.result?.trim()) return undefined;
  const message = latest.error?.trim();
  if (!message || isInternalVerdict(message)) return undefined;
  return formatUserError(message);
}

/**
 * What a dismissal remembers: the thread and the message together.
 *
 * Include the run when known: a later attempt may fail for the same reason
 * and still needs to be visible. The legacy two-argument form stays useful
 * for a notice that does not belong to a persisted run.
 */
export function threadErrorKey(sessionId: string | undefined, message: string | undefined, runId?: string): string | undefined {
  return sessionId && message ? `${sessionId}\u0000${runId ?? ""}\u0000${message}` : undefined;
}

/** The IPC rejection and the failed-run event can report the same fault in
 * either order. Once the run owns it, the top notice must not repeat it — even
 * after dismissal. Other notices (including successful actions) stay visible. */
export function threadFeedback(input: ThreadErrorInput & { notice?: string; dismissed: ReadonlySet<string> }): {
  notice?: string;
  failure?: string;
  failureKey?: string;
} {
  const failure = threadError(input);
  const latest = latestThreadRun(input);
  const failureKey = threadErrorKey(input.sessionId, failure, latest?.id ?? latest?.createdAt);
  const duplicate = Boolean(input.notice && failure && formatUserError(input.notice) === failure);
  return {
    notice: duplicate ? undefined : input.notice,
    failure: failureKey && input.dismissed.has(failureKey) ? undefined : failure,
    failureKey,
  };
}
