import { useEffect } from "react";
import { useWorkspace } from "../../lib/workspace";
import { useAgentStore } from "./agent-store";
import type { PendingUpdate } from "./agent-store-model";
import { CpuIcon } from "../shell/icons";
import "./agent-store.css";

/* Release lookups reach the network; opening the app should not wait on them or be the reason they run first. */
const FIRST_LOOK_MS = 10_000;

function describe(update: PendingUpdate, name: string): string {
  const versions = `${update.from ? `v${update.from}` : "an older version"} to v${update.to}`;
  if (update.how.kind === "store") return `${name}, ${versions}, with Capsule's installer.`;
  return update.how.oneClick ? `${name}, ${versions}, by running ${update.how.command}.` : `${name}, ${versions}: run ${update.how.command} in a terminal.`;
}

/**
 * One quiet icon in the sidebar footer when agents are behind, counting them. It lists what
 * would run and asks first; updates Capsule cannot run itself are named with
 * their command and left to the person.
 */
export function AgentUpdatesPill() {
  const { harnesses, setConfirm, setView } = useWorkspace();
  const store = useAgentStore({ autoload: false });
  const { enabled, ensureLoaded } = store;
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void ensureLoaded(), FIRST_LOOK_MS);
    return () => clearTimeout(timer);
  }, [enabled, ensureLoaded]);

  if (!enabled || store.updates.length === 0) return null;
  const nameOf = (id: string) => harnesses.find((item) => item.id === id)?.name ?? id;
  const runnable = store.updates.filter((item) => item.how.kind === "store" || item.how.oneClick);
  const count = store.updates.length;
  const label = `Update ${count} ${count === 1 ? "agent" : "agents"}`;

  const open = () => {
    if (!runnable.length) {
      setView("runtimes");
      return;
    }
    const manual = store.updates.filter((item) => !runnable.includes(item));
    setConfirm({
      title: runnable.length === 1 ? `Update ${nameOf(runnable[0]!.harnessId)}?` : `Update ${runnable.length} agents?`,
      detail: [...runnable, ...manual].map((item) => describe(item, nameOf(item.harnessId))).join(" ")
        + " Conversations already open keep their version until they start again.",
      confirmLabel: "Update",
      onConfirm: () => {
        setConfirm(undefined);
        void (async () => {
          for (const item of runnable) {
            if (item.how.kind === "store") await store.install(item.harnessId);
            else await store.updateUserCopy(item.harnessId);
          }
        })();
      },
      secondary: { label: "Open Agents", onConfirm: () => { setConfirm(undefined); setView("runtimes"); } },
    });
  };

  /* An icon with a count, like its neighbours: the footer has no room for words beside the app's own update control. */
  const versions = store.updates.map((item) => `${nameOf(item.harnessId)} v${item.to}`).join(", ");
  return <button type="button" className="icon-btn agent-updates" aria-label={label} title={`${label}: ${versions}`} onClick={open}>
    <CpuIcon size={15} />
    <span className="util-badge" aria-hidden="true">{count > 9 ? "9+" : count}</span>
  </button>;
}
