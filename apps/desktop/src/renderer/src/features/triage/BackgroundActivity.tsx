import { useEffect, useRef } from "react";
import type { Run } from "@capsule/shared";
import { backgroundNews, type BackgroundNews } from "../../lib/background-activity";
import { useToasts } from "../../lib/toasts";
import { useWorkspace } from "../../lib/workspace";

const TITLE: Record<BackgroundNews, string> = {
  finished: "finished",
  failed: "failed",
  "needs-approval": "needs your approval",
};

/**
 * Another thread's news, while you are in the app: a toast you can open. The
 * toast's live region is also what a screen reader announces. With the window
 * in the background, the desktop notification carries it instead.
 */
export function BackgroundActivity() {
  const { projectRuns, sessions, sessionId, setProjectId, setView, settings } = useWorkspace();
  const toasts = useToasts();
  const seen = useRef<Map<string, Pick<Run, "status">> | undefined>(undefined);
  const since = useRef(new Date().toISOString());

  useEffect(() => {
    const previous = seen.current;
    seen.current = new Map(projectRuns.map((run) => [run.id, { status: run.status }]));
    const checkpoint = since.current;
    since.current = new Date().toISOString();
    if (!previous || !document.hasFocus() || settings?.notifyRunComplete === false) return;
    for (const item of backgroundNews(previous, projectRuns, sessionId, checkpoint)) {
      const session = sessions.find((entry) => entry.id === item.sessionId);
      if (!session || session.state !== "active") continue;
      toasts.show({
        key: `activity:${item.sessionId}`,
        tone: item.news === "failed" ? "error" : "info",
        title: `“${session.title}” ${TITLE[item.news]}`,
        timeoutMs: item.news === "needs-approval" ? 15_000 : undefined,
        action: {
          label: "Open",
          run: () => { setProjectId(session.projectId, session.id); setView("chat"); },
        },
      });
    }
  }, [projectRuns, sessionId, sessions, setProjectId, setView, settings?.notifyRunComplete, toasts]);

  return null;
}
