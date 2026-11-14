import { useEffect, useMemo } from "react";
import { summariseAttention } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";

/**
 * "Capsule (3)" while three threads wait on you, the same count as the Dock
 * badge. It shows in the Window menu and window switchers, and a screen
 * reader reads it when the window comes forward. A paired viewer's tab gets
 * the same count.
 */
export function useAttentionTitle() {
  const { sessions, projectRuns, sessionId } = useWorkspace();
  const waiting = useMemo(() => {
    const { counts } = summariseAttention({ sessions, runs: projectRuns ?? [], activeSessionId: sessionId });
    return counts["needs-input"] + counts.blocked + counts.ready;
  }, [projectRuns, sessionId, sessions]);
  useEffect(() => {
    document.title = waiting > 0 ? `Capsule (${waiting})` : "Capsule";
  }, [waiting]);
}
