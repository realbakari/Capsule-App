import type { AgentInstallPhase, AgentInstallProgress, AgentStoreEntry, HarnessId } from "@capsule/shared";

/** What Capsule is doing to one agent right now. Removal has no progress event of its own. */
export type StoreActivity = AgentInstallProgress | { harnessId: HarnessId; phase: "removing" };

/** A newer release for a copy the user installed, and how to get it. */
export interface UserCopyUpdate {
  version: string;
  command: string;
  /** Capsule can run `command` itself, after asking. */
  oneClick: boolean;
}

/** What the store shows for one agent, decided once from its entry and any install in flight. */
export type StoreRow =
  | { kind: "none" }
  | { kind: "user"; path: string; version?: string; update?: UserCopyUpdate }
  | { kind: "unavailable"; reason: string }
  | { kind: "offer"; version: string; from: string }
  | { kind: "installed"; version: string; update?: string }
  | { kind: "busy"; label: string; bytes?: string; fraction?: number }
  | { kind: "failed"; error: string; canRetry: boolean };

const PHASE_LABEL: Record<AgentInstallPhase | "removing" | "updating", string> = {
  resolving: "Finding the release",
  downloading: "Downloading",
  verifying: "Checking the download",
  extracting: "Unpacking",
  installing: "Installing",
  linking: "Finishing up",
  removing: "Removing",
  updating: "Updating",
};

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0);
}

export function storeRow(entry: AgentStoreEntry | undefined, activity: StoreActivity | undefined): StoreRow {
  if (activity && activity.phase !== "done") {
    if (activity.phase === "failed") return { kind: "failed", error: activity.error, canRetry: Boolean(entry?.offer && !entry.unavailable) };
    if (activity.phase === "removing" || activity.phase === "updating") return { kind: "busy", label: PHASE_LABEL[activity.phase] };
    const { received, total } = activity;
    const bytes = received === undefined ? undefined
      : total ? `${megabytes(received)} of ${megabytes(total)} MB` : `${megabytes(received)} MB`;
    return { kind: "busy", label: PHASE_LABEL[activity.phase], bytes, fraction: received !== undefined && total ? Math.min(1, received / total) : undefined };
  }
  if (!entry) return { kind: "none" };
  if (entry.user) {
    const { path, version, latest, update } = entry.user;
    return { kind: "user", path, ...(version ? { version } : {}),
      ...(update && latest ? { update: { version: latest, command: update.command, oneClick: update.oneClick } } : {}) };
  }
  if (entry.installed) {
    return { kind: "installed", version: entry.installed.version, update: entry.updateAvailable && entry.offer ? entry.offer.version : undefined };
  }
  if (entry.unavailable) return { kind: "unavailable", reason: entry.unavailable };
  if (entry.offer) return { kind: "offer", version: entry.offer.version, from: entry.offer.source.kind === "registry" ? "from the ACP registry" : "from npm" };
  return { kind: "none" };
}

/** One agent with a newer release waiting, as the update nudge lists it. */
export interface PendingUpdate {
  harnessId: HarnessId;
  from?: string;
  to: string;
  /** What runs it: Capsule's own install, or the command of the tool that owns the copy. */
  how: { kind: "store" } | { kind: "user"; command: string; oneClick: boolean };
}

/*
 * Every agent that is behind. A copy the user installed is the one that runs,
 * so when there is one, Capsule's own copy is not what needs updating.
 */
export function pendingUpdates(entries: Iterable<AgentStoreEntry | undefined>, shown: (harnessId: HarnessId) => boolean = () => true): PendingUpdate[] {
  const pending: PendingUpdate[] = [];
  /* Two presets can launch one copy (a model variant of the same CLI); it is one update. */
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || !shown(entry.harnessId)) continue;
    const user = entry.user;
    const copy = user ? `user:${user.path}` : `store:${JSON.stringify(entry.offer?.source)}`;
    if (seen.has(copy)) continue;
    seen.add(copy);
    if (user?.update && user.latest) {
      pending.push({ harnessId: entry.harnessId, ...(user.version ? { from: user.version } : {}), to: user.latest,
        how: { kind: "user", command: user.update.command, oneClick: user.update.oneClick } });
    } else if (!user && entry.installed && entry.updateAvailable && entry.offer) {
      pending.push({ harnessId: entry.harnessId, from: entry.installed.version, to: entry.offer.version, how: { kind: "store" } });
    }
  }
  return pending;
}

/** Argv as someone would type it, quoting only what needs it. */
export function displayCommand(argv: string[]): string {
  return argv.map((part) => (/^[A-Za-z0-9._:/=@+-]+$/.test(part) ? part : `'${part.replace(/'/g, `'\\''`)}'`)).join(" ");
}
