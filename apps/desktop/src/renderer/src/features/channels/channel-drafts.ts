import type { DraftMention } from "./mentions";

interface Draft {
  content: string;
  mentions: DraftMention[];
  pending: boolean;
  revision: number;
  error?: string;
}

/** View-owned drafts and send admission outlive individual channel/thread composers. */
export class ChannelDrafts {
  private entries = new Map<string, Draft>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  get(key: string): Draft {
    let draft = this.entries.get(key);
    if (!draft) {
      draft = { content: "", mentions: [], pending: false, revision: 0 };
      this.entries.set(key, draft);
    }
    return draft;
  }
  private publish(key: string, draft: Draft) {
    this.entries.set(key, draft);
    for (const listener of this.listeners) listener();
  }
  edit(key: string, value: Partial<Pick<Draft, "content" | "mentions">>) {
    const draft = this.get(key);
    this.publish(key, { ...draft, ...value, revision: draft.revision + 1 });
  }
  setError(key: string, error?: string) {
    this.publish(key, { ...this.get(key), error });
  }
  async send(key: string, post: (draft: Draft) => Promise<unknown>, describeError: (error: unknown) => string): Promise<boolean> {
    const submitted = this.get(key);
    if (submitted.pending || !submitted.content.trim()) return false;
    this.publish(key, { ...submitted, pending: true, error: undefined });
    try {
      await post(submitted);
      const current = this.get(key);
      this.publish(key, {
        ...current, pending: false, error: undefined,
        ...(current.revision === submitted.revision ? { content: "", mentions: [] } : {}),
      });
      return true;
    } catch (error) {
      this.publish(key, { ...this.get(key), pending: false, error: describeError(error) });
      return false;
    }
  }
}
