const STORAGE_KEY = "capsule.channelPrefs";
export const CHANNEL_PREFS_EVENT = "capsule-channel-prefs";
const GROUP_WINDOW_SECONDS = 7 * 60;

export interface ChannelPrefs {
  starred: string[];
  muted: string[];
  lastRead: Record<string, number>;
  lastActivity: Record<string, number>;
  threadWidth: number;
}

export const DEFAULT_CHANNEL_PREFS: ChannelPrefs = {
  starred: [],
  muted: [],
  lastRead: {},
  lastActivity: {},
  threadWidth: 380,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

function numberMap(value: unknown): Record<string, number> {
  const record = asRecord(value);
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "number" && Number.isFinite(item)) out[key] = item;
  }
  return out;
}

export function parseChannelPrefs(value: unknown): ChannelPrefs {
  const record = asRecord(value);
  const width = typeof record.threadWidth === "number" ? record.threadWidth : DEFAULT_CHANNEL_PREFS.threadWidth;
  return {
    starred: stringList(record.starred),
    muted: stringList(record.muted),
    lastRead: numberMap(record.lastRead),
    lastActivity: numberMap(record.lastActivity),
    threadWidth: Math.max(280, Math.min(640, width)),
  };
}

export function loadChannelPrefs(): ChannelPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return parseChannelPrefs(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...DEFAULT_CHANNEL_PREFS, lastRead: {}, lastActivity: {}, starred: [], muted: [] };
  }
}

export function saveChannelPrefs(prefs: ChannelPrefs): ChannelPrefs {
  const next = parseChannelPrefs(prefs);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANNEL_PREFS_EVENT));
  } catch {
    /* quota */
  }
  return next;
}

function withId(list: string[], id: string, on: boolean): string[] {
  const next = list.filter((item) => item !== id);
  if (on) next.unshift(id);
  return next;
}

export function toggleStarred(prefs: ChannelPrefs, id: string): ChannelPrefs {
  return saveChannelPrefs({ ...prefs, starred: withId(prefs.starred, id, !prefs.starred.includes(id)) });
}

export function toggleMuted(prefs: ChannelPrefs, id: string): ChannelPrefs {
  return saveChannelPrefs({ ...prefs, muted: withId(prefs.muted, id, !prefs.muted.includes(id)) });
}

export function markChannelRead(prefs: ChannelPrefs, id: string, latest: number): ChannelPrefs {
  if (!Number.isFinite(latest)) return prefs;
  if (prefs.lastRead[id] === latest && (prefs.lastActivity[id] ?? 0) >= latest) return prefs;
  return saveChannelPrefs({
    ...prefs,
    lastRead: { ...prefs.lastRead, [id]: latest },
    lastActivity: { ...prefs.lastActivity, [id]: Math.max(prefs.lastActivity[id] ?? 0, latest) },
  });
}

export function markChannelUnread(prefs: ChannelPrefs, id: string): ChannelPrefs {
  const activity = prefs.lastActivity[id] ?? prefs.lastRead[id] ?? 1;
  return saveChannelPrefs({
    ...prefs,
    lastRead: { ...prefs.lastRead, [id]: Math.max(0, activity - 1) },
    lastActivity: { ...prefs.lastActivity, [id]: activity },
  });
}

export function recordChannelActivity(prefs: ChannelPrefs, id: string, latest: number): ChannelPrefs {
  if (!Number.isFinite(latest) || latest <= (prefs.lastActivity[id] ?? 0)) return prefs;
  return saveChannelPrefs({
    ...prefs,
    lastActivity: { ...prefs.lastActivity, [id]: latest },
  });
}

export function channelIsUnread(prefs: ChannelPrefs, id: string): boolean {
  if (prefs.muted.includes(id)) return false;
  const activity = prefs.lastActivity[id] ?? 0;
  if (activity <= 0) return false;
  return activity > (prefs.lastRead[id] ?? 0);
}

export function unreadChannelCount(prefs: ChannelPrefs): number {
  return Object.keys(prefs.lastActivity).filter((id) => channelIsUnread(prefs, id)).length;
}

export function shouldGroupChannelPosts(
  previous: { author: string; createdAt: number } | undefined,
  current: { author: string; createdAt: number },
): boolean {
  return Boolean(
    previous &&
      previous.author === current.author &&
      current.createdAt - previous.createdAt >= 0 &&
      current.createdAt - previous.createdAt < GROUP_WINDOW_SECONDS,
  );
}

export function clampThreadWidth(width: number): number {
  return Math.max(280, Math.min(640, Math.round(width)));
}
