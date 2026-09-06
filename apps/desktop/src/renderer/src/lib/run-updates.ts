import type { ChatMessage, Run, RunEvent } from "@capsule/shared";
import { boundRunEvents, compactRunEvent, localTimings } from "@capsule/shared";

/** Snapshots and the live channel overlap; IDs, not arrival timing, deduplicate them. */
export function mergeRuns(snapshot: Run[], live: Run[]): Run[] {
  const merged = new Map(snapshot.map((run) => [run.id, run]));
  for (const run of live) {
    const existing = merged.get(run.id);
    if (!existing || run.updatedAt >= existing.updatedAt) merged.set(run.id, run);
  }
  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function mergeRunEvents(snapshot: RunEvent[], live: RunEvent[], runId: string): RunEvent[] {
  const merged = new Map<string, RunEvent>();
  for (const event of [...snapshot, ...live]) if (event.runId === runId) merged.set(event.id, event);
  return boundRunEvents([...merged.values()].map(compactRunEvent).sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
}

/** A newest-page refresh must not discard older pages or frames received during the read. */
export function mergeMessagePage(current: ChatMessage[], page: ChatMessage[]): ChatMessage[] {
  const merged = new Map(current.filter((item) => !item.id.startsWith("local-") || !page.some(
    (saved) => saved.role === item.role && saved.content === item.content,
  )).map((item) => [item.id, item]));
  for (const message of page) merged.set(message.id, message);
  return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Flush on a short cadence, or early for a large burst. Never drop terminal frames. */
export function batchRunFrames(consume: (frames: Array<Run | RunEvent>) => void, delay = 50) {
  let frames: Array<Run | RunEvent> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    const batch = frames; frames = [];
    if (batch.length) {
      const end = localTimings.start("events.renderer");
      try { consume(batch); end(); } catch (error) { end(true); throw error; }
    }
  };
  return {
    push(frame: Run | RunEvent) {
      frames.push(frame);
      if (frames.length >= 128 || ("status" in frame && Boolean(frame.completedAt))) flush();
      else timer ??= setTimeout(flush, delay);
    },
    dispose() { clearTimeout(timer); frames = []; },
  };
}
