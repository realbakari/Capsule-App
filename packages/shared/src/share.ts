/*
 * Sharing one thread, and who is looking at it.
 *
 * A share link is a grant for exactly one thread: the holder reads that
 * thread's messages, turns, tool activity, diffs and artifacts, and nothing
 * else on this computer. Presence is the other direction: which devices are
 * reading a thread right now, so the person at the desktop is never surprised.
 */

export type ShareLinkExpiry = "1h" | "1d" | "7d" | "never";

export const SHARE_LINK_EXPIRY_MS: Record<ShareLinkExpiry, number | undefined> = {
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  never: undefined,
};

export const SHARE_LINK_EXPIRY_LABEL: Record<ShareLinkExpiry, string> = {
  "1h": "1 hour",
  "1d": "1 day",
  "7d": "7 days",
  never: "Never",
};

/** A read-only grant for one thread. Only a hash of its secret is ever stored. */
export interface ShareGrant {
  id: string;
  sessionId: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  label?: string;
}

/** What creating a link returns: the URL is shown once and never stored. */
export interface CreatedShareLink {
  grant: ShareGrant;
  url: string;
}

export function shareGrantActive(grant: ShareGrant, now = Date.now()): boolean {
  if (grant.revokedAt) return false;
  return !grant.expiresAt || Date.parse(grant.expiresAt) > now;
}

export type PresenceViewerKind = "browser" | "phone" | "share-link";

export interface PresenceViewer {
  kind: PresenceViewerKind;
  label: string;
  /** Epoch milliseconds: when this device connected. */
  since: number;
}

export interface ThreadPresence {
  sessionId: string;
  viewers: PresenceViewer[];
}

/** One live connection to the remote viewer, as the server sees it. */
export interface RemoteViewerRecord {
  id: string;
  /** A paired device, or a holder of one thread's share link. */
  access: "paired" | "share";
  /** The device's own description of itself, usually its user agent. */
  label: string;
  since: number;
  /** The thread it last read, or the thread its share link is for. */
  sessionId?: string;
}

/** Phone, browser, or share link, from what the device said about itself. */
export function presenceKind(viewer: Pick<RemoteViewerRecord, "access" | "label">): PresenceViewerKind {
  if (viewer.access === "share") return "share-link";
  return /iPhone|iPad|iPod|Android|Mobile/u.test(viewer.label) ? "phone" : "browser";
}

/** A short device name a person would recognise, never the raw user agent. */
export function presenceLabel(viewer: Pick<RemoteViewerRecord, "access" | "label">): string {
  if (viewer.access === "share") return "Share link";
  const label = viewer.label;
  if (/iPhone/u.test(label)) return "iPhone";
  if (/iPad/u.test(label)) return "iPad";
  if (/Android/u.test(label)) return /Mobile/u.test(label) ? "Android phone" : "Android tablet";
  const browser = /Edg\//u.test(label) ? "Edge" : /Firefox\//u.test(label) ? "Firefox"
    : /Chrome\//u.test(label) ? "Chrome" : /Safari\//u.test(label) ? "Safari" : undefined;
  const system = /Macintosh|Mac OS X/u.test(label) ? "Mac" : /Windows/u.test(label) ? "Windows"
    : /Linux|X11/u.test(label) ? "Linux" : undefined;
  if (browser && system) return `${browser} on ${system}`;
  if (browser) return browser;
  if (system) return `Browser on ${system}`;
  return label.trim().slice(0, 40) || "Browser";
}

/** Who is viewing each thread. Threads nobody is viewing are left out. */
export function aggregatePresence(viewers: readonly RemoteViewerRecord[]): ThreadPresence[] {
  const byThread = new Map<string, PresenceViewer[]>();
  for (const viewer of viewers) {
    if (!viewer.sessionId) continue;
    const list = byThread.get(viewer.sessionId) ?? [];
    list.push({ kind: presenceKind(viewer), label: presenceLabel(viewer), since: viewer.since });
    byThread.set(viewer.sessionId, list);
  }
  return [...byThread].map(([sessionId, list]) => ({
    sessionId,
    viewers: list.sort((a, b) => a.since - b.since || a.label.localeCompare(b.label)),
  })).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

/** "Also open on iPhone", "2 viewers": the header's words for a thread's viewers. */
export function presenceSummary(viewers: readonly PresenceViewer[]): string | undefined {
  if (viewers.length === 0) return undefined;
  if (viewers.length === 1) {
    const [viewer] = viewers;
    return viewer!.kind === "share-link" ? "Open from a share link" : `Also open on ${viewer!.label}`;
  }
  return `${viewers.length} viewers`;
}

/*
 * The thread a paired device is reading, from the call it made. Reading a
 * thread's messages or turns is what opening it does; every other call leaves
 * the answer where it was.
 */
export function viewedSessionId(channel: string, args: readonly unknown[]): string | undefined {
  if (channel === "listMessagePage" || channel === "listMessages") {
    return typeof args[0] === "string" && args[0] ? args[0] : undefined;
  }
  if (channel === "listRunPage") {
    const query = args[0];
    const sessionId = query && typeof query === "object" ? (query as { sessionId?: unknown }).sessionId : undefined;
    return typeof sessionId === "string" && sessionId ? sessionId : undefined;
  }
  return undefined;
}
