import type { ShareGrant } from "@capsule/shared";

function span(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** "Created 5m ago · expires in 23h", or "· never expires". */
export function shareLinkTiming(grant: ShareGrant, now = Date.now()): string {
  const age = now - Date.parse(grant.createdAt);
  const created = age < 60_000 ? "Created just now" : `Created ${span(age)} ago`;
  const expires = grant.expiresAt ? `expires in ${span(Date.parse(grant.expiresAt) - now)}` : "never expires";
  return `${created} · ${expires}`;
}

/** "since 10:42" in the viewer's own clock. */
export function sinceLabel(since: number): string {
  return `since ${new Date(since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
