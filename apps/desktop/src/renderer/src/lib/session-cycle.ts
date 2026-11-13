import type { Session } from "@capsule/shared";

/**
 * The conversation ⌃Tab moves to: the next one by most recent activity,
 * wrapping at the ends, skipping archived ones. With nothing selected it starts
 * at the most recent.
 */
export function adjacentSession(sessions: Session[], currentId: string | undefined, step: 1 | -1): Session | undefined {
  const ordered = sessions
    .filter((session) => session.state === "active")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  if (ordered.length === 0) return undefined;
  const index = ordered.findIndex((session) => session.id === currentId);
  if (index < 0) return ordered[0];
  return ordered[(index + step + ordered.length) % ordered.length];
}
