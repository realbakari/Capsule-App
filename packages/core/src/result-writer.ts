import { TextBudget } from "@capsule/shared";

const SAVE_STEP_BYTES = 64 * 1024;
const SAVE_INTERVAL_MS = 1000;

/** Save on meaningful growth, not on each token; completion always flushes. */
export class ResultWriter {
  private readonly savedBytes = new Map<string, number>();
  private readonly pending = new Set<string>();
  private readonly authoritativeReplies = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly buffers: TextBudget, private readonly save: (id: string, result: string) => void) {}

  append(id: string, text: string): void {
    // The Gateway can deliver both token events and completed ACP messages.
    // Once a message arrives, that channel owns the result for this turn.
    if (this.authoritativeReplies.has(id)) return;
    const key = `run:${id}`;
    this.buffers.append(key, text);
    this.pending.add(id);
    const bytes = this.buffers.sizeOf(key);
    if (bytes - (this.savedBytes.get(id) ?? 0) >= SAVE_STEP_BYTES) {
      this.save(id, this.buffers.text(key));
      this.savedBytes.set(id, bytes);
    }
    this.scheduleSave();
  }

  recordReply(id: string, content: string, previous = ""): string {
    const result = !previous || content.startsWith(previous) ? content
      : previous.endsWith(content) ? previous : `${previous}\n${content}`;
    this.buffers.append(`run:${id}`, result, true);
    this.authoritativeReplies.add(id);
    this.pending.add(id);
    this.save(id, result);
    this.savedBytes.set(id, this.buffers.sizeOf(`run:${id}`));
    return result;
  }

  private scheduleSave(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const id of this.pending) {
        const bytes = this.buffers.sizeOf(`run:${id}`);
        if (bytes === this.savedBytes.get(id)) continue;
        this.save(id, this.buffers.text(`run:${id}`));
        this.savedBytes.set(id, bytes);
      }
    }, SAVE_INTERVAL_MS);
    this.timer.unref();
  }

  finishAll(): void {
    for (const id of this.pending) this.finish(id);
  }

  finish(id: string): string | undefined {
    const key = `run:${id}`;
    const present = this.buffers.sizeOf(key) > 0;
    const result = this.buffers.take(key);
    this.savedBytes.delete(id);
    this.release(id);
    if (present) this.save(id, result);
    return present ? result : undefined;
  }

  discard(id: string): void {
    this.buffers.delete(`run:${id}`);
    this.savedBytes.delete(id);
    this.release(id);
  }

  private release(id: string): void {
    this.pending.delete(id);
    this.authoritativeReplies.delete(id);
    if (!this.pending.size && this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
