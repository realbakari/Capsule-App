import { useEffect, useState } from "react";
import { formatDuration } from "../../lib/turns";

/** A clock that keeps counting from a timestamp, for a turn or a tool group in flight. */
export function RunElapsed({ startedAt, className = "run-elapsed" }: { startedAt: string; className?: string }) {
  const startedMs = Date.parse(startedAt);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1_000);
    return () => window.clearInterval(id);
  }, [startedMs]);
  if (Number.isNaN(startedMs)) return null;
  return <span className={className}>{formatDuration(Math.max(0, Date.now() - startedMs))}</span>;
}
