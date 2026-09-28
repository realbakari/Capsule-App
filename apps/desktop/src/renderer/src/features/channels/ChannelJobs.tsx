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
  return <JobsContext.Provider value={jobs}>{error && <p className="channels-error" role="alert">Local run status unavailable: {error}</p>}{children}</JobsContext.Provider>;
}
export function useChannelJob(messageId: string) { return useContext(JobsContext).find((job) => job.messageId === messageId); }
