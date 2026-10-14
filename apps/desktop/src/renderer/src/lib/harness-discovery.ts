import { useEffect, useState } from "react";
import type { HarnessDiscovery } from "@capsule/shared";
import type { CapsuleApi } from "../../../preload/index";
import { formatUserError } from "./errors";

/** Discovery is scoped to a draft, not a running conversation or another agent. */
export function useHarnessDiscovery(api: CapsuleApi, projectId: string | undefined, harnessId: string, model: string | undefined, enabled: boolean, sessionId?: string) {
  const key = JSON.stringify([projectId, sessionId, harnessId, model]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; result?: HarnessDiscovery; error?: string }>();
  useEffect(() => {
    if (!enabled || !projectId || api.isDesktop !== true) return;
    if (!api.discoverHarness) { setState({ key, error: "Restart Capsule to load model discovery." }); return; }
    let current = true;
    setState({ key });
    void api.discoverHarness(projectId, harnessId, model, sessionId).then(
      (result) => { if (current) setState({ key, result }); },
      (error: unknown) => { if (current) setState({ key, error: formatUserError(error) }); },
    );
    return () => { current = false; };
  }, [api, projectId, sessionId, harnessId, model, enabled, key, attempt]);
  const matching = enabled && state?.key === key ? state : undefined;
  return { result: matching?.result, error: matching?.error,
    loading: enabled && Boolean(projectId) && !matching?.result && !matching?.error,
    retry: () => setAttempt((value) => value + 1) };
}
