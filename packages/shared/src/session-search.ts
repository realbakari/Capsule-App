import type { Session } from "./types.js";

/** Exact titles first; other matches follow activity, independently of sidebar pins. */
export function searchSessionTitles(sessions: readonly Session[], query: string): Session[] {
  const needle = query.trim().toLowerCase();
  const recency = (session: Session) => Date.parse(session.updatedAt) || 0;
  return sessions.filter((session) => session.title.toLowerCase().includes(needle)).sort((a, b) => {
    const exactA = Boolean(needle) && a.title.toLowerCase() === needle;
    const exactB = Boolean(needle) && b.title.toLowerCase() === needle;
    return Number(exactB) - Number(exactA) || recency(b) - recency(a) || a.id.localeCompare(b.id);
  });
}
