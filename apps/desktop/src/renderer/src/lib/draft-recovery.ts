import { readPromptDraft, writePromptDraft, type PromptDraft, type PromptStorage } from "./prompt-stash";

/** Only failed durable writes live here. Never evict another unsaved draft. */
export class DraftRecovery {
  private readonly drafts = new Map<string, PromptDraft>();

  read(storage: PromptStorage, key: string): PromptDraft {
    return this.drafts.get(key) ?? readPromptDraft(storage, key);
  }

  save(storage: PromptStorage, key: string, value: PromptDraft): "saved" | "temporary" | "full" {
    if (writePromptDraft(storage, key, value)) {
      this.drafts.delete(key);
      return "saved";
    }
    const size = (draft: PromptDraft) => JSON.stringify(draft).length * 2;
    let bytes = size(value);
    for (const [otherKey, draft] of this.drafts) if (otherKey !== key) bytes += size(draft);
    if ((!this.drafts.has(key) && this.drafts.size >= 32) || bytes > 8 * 1024 * 1024) return "full";
    this.drafts.set(key, value);
    return "temporary";
  }
}
