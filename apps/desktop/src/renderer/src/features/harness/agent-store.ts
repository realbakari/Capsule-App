import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { agentEnabled, type AgentInstallProgress, type AgentStoreEntry, type HarnessId } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { pendingUpdates, storeRow, type StoreActivity } from "./agent-store-model";

type Api = typeof window.capsule;

interface StoreSnapshot {
  entries: Partial<Record<string, AgentStoreEntry>>;
  activity: Partial<Record<string, StoreActivity>>;
  load: "idle" | "loading" | "loaded" | { error: string };
}

/*
 * One store for the window. An install started from the composer's notice is
 * still in flight when the Agents view or first run opens, so its progress
 * belongs to the app, not to whichever control started it.
 */
let snapshot: StoreSnapshot = { entries: {}, activity: {}, load: "idle" };
const listeners = new Set<() => void>();
let subscribedApi: Api | undefined;

function update(next: Partial<StoreSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function setActivity(harnessId: string, activity: StoreActivity | undefined): void {
  const next = { ...snapshot.activity };
  if (activity) next[harnessId] = activity;
  else delete next[harnessId];
  update({ activity: next });
}

function setEntry(entry: AgentStoreEntry): void {
  update({ entries: { ...snapshot.entries, [entry.harnessId]: entry } });
}

function storeAvailable(api: Api): boolean {
  return api.isDesktop !== false && typeof api.agentStoreList === "function";
}

async function loadStore(api: Api, refresh = false): Promise<void> {
  if (!storeAvailable(api)) return;
  if (subscribedApi !== api) {
    subscribedApi = api;
    api.on("agentInstallProgress", (payload) => {
      const progress = payload as AgentInstallProgress;
      /* "done" is settled by the install call's own result, which carries the new entry. */
      if (progress?.harnessId && progress.phase !== "done") setActivity(progress.harnessId, progress);
    });
  }
  update({ load: "loading" });
  try {
    const list = await api.agentStoreList(refresh);
    update({ entries: Object.fromEntries(list.map((entry) => [entry.harnessId, entry])), load: "loaded" });
  } catch (error) {
    update({ load: { error: formatUserError(error) } });
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Resets the window's store. Tests only. */
export function resetAgentStore(): void {
  snapshot = { entries: {}, activity: {}, load: "idle" };
  subscribedApi = undefined;
  for (const listener of listeners) listener();
}

/**
 * The agent store as the renderer sees it. `enabled` is false on a paired
 * device: install and removal are write channels, so a viewer only reads.
 * `autoload: false` leaves the first list to whoever needs it first, for a
 * caller that should not reach the network as the app opens.
 */
export function useAgentStore({ autoload = true }: { autoload?: boolean } = {}) {
  const { api, refresh, settings } = useWorkspace();
  const state = useSyncExternalStore(subscribe, () => snapshot);
  const enabled = storeAvailable(api);
  useEffect(() => {
    if (autoload && enabled && snapshot.load === "idle") void loadStore(api);
  }, [api, enabled, autoload]);

  /* A new or removed copy changes readiness; the doctor re-probes it and refresh picks it up. */
  const recheck = useCallback(async (harnessId: string) => {
    await api.doctorHarness(harnessId).catch(() => undefined);
    await refresh().catch(() => undefined);
  }, [api, refresh]);

  const install = useCallback(async (harnessId: HarnessId) => {
    if (!enabled) return;
    setActivity(harnessId, { harnessId, phase: "resolving" });
    try {
      setEntry(await api.agentStoreInstall(harnessId));
      setActivity(harnessId, undefined);
      await recheck(harnessId);
    } catch (error) {
      setActivity(harnessId, { harnessId, phase: "failed", error: formatUserError(error) });
    }
  }, [api, enabled, recheck]);

  const uninstall = useCallback(async (harnessId: HarnessId) => {
    if (!enabled) return;
    setActivity(harnessId, { harnessId, phase: "removing" });
    try {
      setEntry(await api.agentStoreUninstall(harnessId));
      setActivity(harnessId, undefined);
      await recheck(harnessId);
    } catch (error) {
      setActivity(harnessId, { harnessId, phase: "failed", error: formatUserError(error) });
    }
  }, [api, enabled, recheck]);

  /* The owning tool replaces the copy; Capsule only asked first and reports what happened. */
  const updateUserCopy = useCallback(async (harnessId: HarnessId) => {
    if (!enabled) return;
    setActivity(harnessId, { harnessId, phase: "updating", detail: "" });
    try {
      setEntry(await api.agentStoreUpdateUserCopy(harnessId));
      setActivity(harnessId, undefined);
      await recheck(harnessId);
    } catch (error) {
      setActivity(harnessId, { harnessId, phase: "failed", error: formatUserError(error) });
    }
  }, [api, enabled, recheck]);

  const ensureLoaded = useCallback(() => (snapshot.load === "idle" ? loadStore(api) : Promise.resolve()), [api]);
  const relist = useCallback(() => loadStore(api), [api]);
  const row = useCallback((harnessId: string) => storeRow(state.entries[harnessId], state.activity[harnessId]), [state]);
  const overrides = settings?.agentOverrides;
  const updates = useMemo(
    () => pendingUpdates(Object.values(state.entries), (harnessId) => agentEnabled(overrides, harnessId) && !state.activity[harnessId]),
    [state, overrides],
  );

  return {
    enabled,
    load: state.load,
    row,
    updates,
    install,
    uninstall,
    updateUserCopy,
    /** Lists if nothing has yet. */
    ensureLoaded,
    /** Lists again without asking the registries, after an agent appeared or moved on this computer. */
    relist,
    reload: () => loadStore(api, true),
  };
}
