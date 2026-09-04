import { useMemo } from "react";
import type { GitPullRequestCheck } from "@capsule/shared";

/*
 * What the checks actually say.
 *
 * The summary reduced twenty-seven checks to the word "success" — enough to
 * know nothing is wrong, useless the moment something is. These are the runs
 * by name, failures first, because a failing check is the only one anybody
 * opens this to find.
 */

const ORDER: Record<GitPullRequestCheck["state"], number> = {
  failure: 0,
  pending: 1,
  cancelled: 2,
  neutral: 3,
  skipped: 4,
  success: 5,
};

const LABEL: Record<GitPullRequestCheck["state"], string> = {
  failure: "Failed",
  pending: "Pending",
  cancelled: "Cancelled",
  neutral: "Neutral",
  skipped: "Skipped",
  success: "Passed",
};

function CheckStatusIcon({ state }: { state: GitPullRequestCheck["state"] }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <circle cx="8" cy="8" r="6" strokeDasharray={state === "skipped" || state === "neutral" ? "2 2" : undefined} />
    {state === "success" ? <path d="m5 8 2 2 4-4" /> : state === "failure" ? <path d="m6 6 4 4m0-4-4 4" /> : state === "pending" ? <path d="M8 4.5V8l2 1" /> : state === "cancelled" ? <path d="m4 12 8-8" /> : null}
  </svg>;
}

export interface ChecksTally {
  passing: number;
  /*
   * Every check, skipped ones included. GitHub counts them, so a PR that
   * reports 27 checks there must not report 19 here — the same pull request
   * disagreeing with itself is worse than either number alone.
   */
  total: number;
  failing: number;
  pending: number;
}

export function tallyChecks(checks: GitPullRequestCheck[]): ChecksTally {
  let passing = 0;
  let failing = 0;
  let pending = 0;
  for (const check of checks) {
    if (check.state === "success") passing += 1;
    else if (check.state === "failure") failing += 1;
    else if (check.state === "pending") pending += 1;
  }
  return { passing, total: checks.length, failing, pending };
}

/** The one line that goes next to the title. */
export function ChecksBadge({ checks }: { checks: GitPullRequestCheck[] }) {
  const tally = useMemo(() => tallyChecks(checks), [checks]);
  if (tally.total === 0) return null;
  const tone = tally.failing > 0 ? "failure" : tally.pending > 0 ? "pending" : tally.passing > 0 ? "success" : "neutral";
  return (
    <span className={`checks-badge checks-badge--${tone}`}>
      <CheckStatusIcon state={tone} />
      {tally.passing} of {tally.total} passing
    </span>
  );
}

export function PullRequestChecks({ checks, onOpenUrl }: {
  checks: GitPullRequestCheck[];
  onOpenUrl: (url: string) => void;
}) {
  const sorted = useMemo(
    () =>
      [...checks].sort(
        (left, right) => ORDER[left.state] - ORDER[right.state] || left.name.localeCompare(right.name),
      ),
    [checks],
  );
  if (sorted.length === 0) return null;
  return (
        <ul className="pr-checks">
          {sorted.map((check) => {
            const row = (
              <>
                <span className={`pr-check-glyph pr-check-glyph--${check.state}`} aria-hidden>
                  <CheckStatusIcon state={check.state} />
                </span>
                <span className="pr-check-copy">
                  <span className="pr-check-name" title={check.name}>{check.name}</span>
                  {check.workflow ? <span className="pr-check-workflow" title={check.workflow}>{check.workflow}</span> : null}
                </span>
                <span className={`pr-check-state pr-check-state--${check.state}`}>{LABEL[check.state]}</span>
              </>
            );
            return (
              <li key={`${check.workflow ?? ""}/${check.name}`}>
                {check.url ? (
                  <a href={check.url} className="pr-check" onClick={(event) => {
                    event.preventDefault();
                    onOpenUrl(check.url!);
                  }}>
                    {row}
                  </a>
                ) : (
                  <span className="pr-check">{row}</span>
                )}
              </li>
            );
          })}
        </ul>
  );
}
