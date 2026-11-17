import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ChannelHarnessJob } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";

const JobsContext = createContext<ChannelHarnessJob[]>([]);
export function ChannelJobs({ channelId, children }: { channelId: string; children: ReactNode }) {
  const { api } = useWorkspace();
  const [jobs, setJobs] = useState<ChannelHarnessJob[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!api.isDesktop || !api.listChannelHarnessJobs) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (!document.hidden) {
          const next = await api.listChannelHarnessJobs(channelId);
          if (active) { setJobs(next); setError(undefined); }
        }
      } catch (reason) { if (active) setError(formatUserError(reason)); }
      finally { if (active) timer = setTimeout(poll, 1500); }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [api, channelId]);
  return <JobsContext.Provider value={jobs}>{error && <p className="channels-error" role="alert">Could not read agent replies: {error}</p>}{children}</JobsContext.Provider>;
}
const JOB_STATUS: Record<ChannelHarnessJob["status"], string> = {
  starting: "Starting", queued: "Queued", running: "Working", waiting: "Waiting", approval_required: "Needs your approval",
  completed: "Done", failed: "Failed", cancelled: "Stopped", blocked: "Blocked",
};
export function channelJobStatus(job: ChannelHarnessJob): string { return JOB_STATUS[job.status]; }
export function useChannelJob(messageId: string) { return useContext(JobsContext).find((job) => job.messageId === messageId); }
