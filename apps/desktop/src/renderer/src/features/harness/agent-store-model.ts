import type { AgentInstallPhase, AgentInstallProgress, AgentStoreEntry, HarnessId } from "@capsule/shared";

/** What Capsule is doing to one agent right now. Removal has no progress event of its own. */
export type StoreActivity = AgentInstallProgress | { harnessId: HarnessId; phase: "removing" };

/** What the store shows for one agent, decided once from its entry and any install in flight. */
export type StoreRow =
  | { kind: "none" }
  | { kind: "user"; path: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "offer"; version: string; from: string }
  | { kind: "installed"; version: string; update?: string }
  | { kind: "busy"; label: string; bytes?: string; fraction?: number }
  | { kind: "failed"; error: string; canRetry: boolean };

const PHASE_LABEL: Record<AgentInstallPhase | "removing", string> = {
  resolving: "Finding the release",
  downloading: "Downloading",
  verifying: "Checking the download",
  extracting: "Unpacking",
  installing: "Installing",
  linking: "Finishing up",
  removing: "Removing",
};

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0);
}

export function storeRow(entry: AgentStoreEntry | undefined, activity: StoreActivity | undefined): StoreRow {
  if (activity && activity.phase !== "done") {
    if (activity.phase === "failed") return { kind: "failed", error: activity.error, canRetry: Boolean(entry?.offer && !entry.unavailable) };
    if (activity.phase === "removing") return { kind: "busy", label: PHASE_LABEL.removing };
    const { received, total } = activity;
    const bytes = received === undefined ? undefined
      : total ? `${megabytes(received)} of ${megabytes(total)} MB` : `${megabytes(received)} MB`;
    return { kind: "busy", label: PHASE_LABEL[activity.phase], bytes, fraction: received !== undefined && total ? Math.min(1, received / total) : undefined };
  }
  if (!entry) return { kind: "none" };
  if (entry.userPath) return { kind: "user", path: entry.userPath };
  if (entry.installed) {
    return { kind: "installed", version: entry.installed.version, update: entry.updateAvailable && entry.offer ? entry.offer.version : undefined };
  }
  if (entry.unavailable) return { kind: "unavailable", reason: entry.unavailable };
  if (entry.offer) return { kind: "offer", version: entry.offer.version, from: entry.offer.source.kind === "registry" ? "from the ACP registry" : "from npm" };
  return { kind: "none" };
}

/** Argv as someone would type it, quoting only what needs it. */
export function displayCommand(argv: string[]): string {
  return argv.map((part) => (/^[A-Za-z0-9._:/=@+-]+$/.test(part) ? part : `'${part.replace(/'/g, `'\\''`)}'`)).join(" ");
}
