import { hasTags, parseThreadQuery } from "./thread-tags.js";
import type { Session } from "./types.js";

/**
 * Exact titles first; other matches follow activity, independently of sidebar
 * pins. `tag:name` or `#name` in the query keeps only threads with that tag.
 */
export function searchSessionTitles(sessions: readonly Session[], query: string): Session[] {
  const { text: needle, tags } = parseThreadQuery(query);
  const recency = (session: Session) => Date.parse(session.updatedAt) || 0;
  return sessions.filter((session) => hasTags(session, tags) && session.title.toLowerCase().includes(needle)).sort((a, b) => {
    const exactA = Boolean(needle) && a.title.toLowerCase() === needle;
    const exactB = Boolean(needle) && b.title.toLowerCase() === needle;
    return Number(exactB) - Number(exactA) || recency(b) - recency(a) || a.id.localeCompare(b.id);
  });
}
