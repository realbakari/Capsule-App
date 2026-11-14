import { useCallback, useEffect, useState } from "react";
import { presenceSummary, type ThreadPresence } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { LinkIcon, SmartphoneIcon, UsersIcon } from "../shell/icons";
import { sinceLabel } from "./share-time";

/* Who is viewing which thread, from the host. Desktop only: a viewer is not told about the others. */
export function useThreadPresence(): ThreadPresence[] {
  const { api } = useWorkspace();
  const desktop = api.isDesktop !== false;
  const [presence, setPresence] = useState<ThreadPresence[]>([]);
  const load = useCallback(() => {
    if (!desktop) return;
    void Promise.resolve().then(() => api.threadPresence()).then(setPresence, () => setPresence([]));
  }, [api, desktop]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!desktop) return undefined;
    const off = api.on("state", (event) => {
      if (event && typeof event === "object" && "command" in event && event.command === "remote-updated") load();
    });
    return () => { off(); };
  }, [api, desktop, load]);
  return presence;
}

/** "Also open on iPhone", beside the thread's name. Nothing at all while only this desktop is viewing. */
export function PresenceIndicator() {
  const { session } = useWorkspace();
  const presence = useThreadPresence();
  const viewers = presence.find((item) => item.sessionId === session?.id)?.viewers ?? [];
  const summary = presenceSummary(viewers);
  if (!summary) return null;
  const details = viewers.map((viewer) => `${viewer.label}, ${sinceLabel(viewer.since)}`).join(" · ");
  const Icon = viewers.length > 1 ? UsersIcon : viewers[0]!.kind === "phone" ? SmartphoneIcon : viewers[0]!.kind === "share-link" ? LinkIcon : UsersIcon;
  return (
    // Keyed by its text: the shared tooltip holds a title aside while it shows and would restore a stale one.
    <span key={details} className="presence-indicator" role="status" tabIndex={0} title={`Viewing now: ${details}`} aria-label={`${summary}. Viewing now: ${details}`}>
      <Icon size={12} aria-hidden />
      <span>{summary}</span>
    </span>
  );
}
