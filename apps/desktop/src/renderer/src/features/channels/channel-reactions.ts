import type { ChannelReaction } from "@capsule/shared";

interface Snapshot { reactions?: ChannelReaction[]; busy: boolean; error?: string }
const EMPTY: Snapshot = { busy: false };

/** Owned by one connected view, never shared across relay identities. */
export class ChannelReactions {
  private entries = new Map<string, Snapshot>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get = (id: string): Snapshot => this.entries.get(id) ?? EMPTY;
  private publish(id: string, value: Snapshot) {
    this.entries.set(id, value);
    if (this.entries.size > 300) {
      const oldest = [...this.entries].find(([key, entry]) => key !== id && !entry.busy);
      if (oldest) this.entries.delete(oldest[0]);
    }
    for (const listener of this.listeners) listener();
  }
  async perform(id: string, read: () => Promise<ChannelReaction[]>, write: (() => Promise<void>) | undefined, describe: (error: unknown) => string) {
    if (this.get(id).busy) return;
    this.publish(id, { ...this.get(id), busy: true, error: undefined });
    let accepted = false;
    try {
      if (write) { await write(); accepted = true; this.publish(id, { busy: true }); }
      this.publish(id, { reactions: await read(), busy: false });
    } catch (error) {
      this.publish(id, { ...this.get(id), busy: false, error: `${accepted ? "Change accepted, but counts could not be refreshed. " : ""}${describe(error)}` });
    }
  }
}
