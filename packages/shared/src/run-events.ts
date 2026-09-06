import type { RunEvent } from "./types.js";

export const LIVE_EVENT_LIMIT = 1000;
export const LIVE_EVENT_BYTES = 2_000_000;
export interface RunEventCursor { timestamp: string; id: string }
export interface RunEventPage { events: RunEvent[]; hasMore: boolean; before?: RunEventCursor }
const compacted = new WeakMap<RunEvent, RunEvent>();

/** Diagnostic events must not retain repeated megabyte-sized tool snapshots. */
export function compactRunEvent(event: RunEvent): RunEvent {
  const cached = compacted.get(event);
  if (cached) return cached;
  let remaining = 8192;
  let nodes = 512;
  let truncated = false;
  const clip = (text: string, limit: number) => {
    if (text.length <= limit) return text;
    truncated = true;
    return text.slice(0, limit);
  };
  const walk = (value: unknown, depth = 0): unknown => {
    if (--nodes < 0 || remaining <= 0) { truncated = true; return "[truncated]"; }
    if (typeof value === "string") {
      const text = clip(value, Math.min(2048, remaining)); remaining -= text.length; return text;
    }
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (depth >= 6 || remaining <= 0) { truncated = true; return "[truncated]"; }
    if (Array.isArray(value)) {
      if (value.length > 32) truncated = true;
      const entries: unknown[] = [];
      for (const entry of value.slice(0, 32)) {
        if (nodes <= 0 || remaining <= 0) { truncated = true; break; }
        entries.push(walk(entry, depth + 1));
      }
      return entries;
    }
    if (typeof value !== "object") return undefined;
    const keys = Object.keys(value);
    if (keys.length > 32) truncated = true;
    const result: Record<string, unknown> = {};
    for (const key of keys.slice(0, 32)) {
      if (nodes <= 0 || remaining <= 0) { truncated = true; break; }
      const name = clip(key, Math.min(128, remaining)); remaining -= name.length;
      result[name] = walk((value as Record<string, unknown>)[key], depth + 1);
    }
    return result;
  };
  const message = clip(event.message, 8192);
  const data = event.data ? walk(event.data) as Record<string, unknown> : undefined;
  const result = truncated ? { ...event, message, data: { ...data, payloadTruncated: true } } : event;
  compacted.set(event, result);
  compacted.set(result, result);
  return result;
}

const sizes = new WeakMap<RunEvent, number>();
export function runEventBytes(event: RunEvent): number {
  let bytes = sizes.get(event);
  if (bytes === undefined) {
    bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
    sizes.set(event, bytes);
  }
  return bytes;
}

/** Input is chronological. Keep the newest bounded window and disclose omissions. */
export function boundRunEvents(events: RunEvent[], earlier = false): RunEvent[] {
  let bytes = 0;
  let start = events.length;
  while (start > 0 && events.length - start < LIVE_EVENT_LIMIT) {
    const next = runEventBytes(events[start - 1]!);
    if (bytes + next > LIVE_EVENT_BYTES - 64) break; // Room for the omission marker.
    bytes += next; start--;
  }
  const result = events.slice(start);
  if (result[0] && (start > 0 || earlier || events.some((event) => event.data?.earlierEvents))) {
    result[0] = { ...result[0], data: { ...result[0].data, earlierEvents: true } };
  }
  return result;
}
