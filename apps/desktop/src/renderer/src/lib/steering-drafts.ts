interface SteeringDraft {
  text: string;
  revision: number;
  pending: boolean;
}

/** Submission ownership is a draft object, never the currently selected thread. */
export class SteeringDrafts {
  private readonly drafts = new Map<string, SteeringDraft>();

  get(key: string): SteeringDraft {
    let draft = this.drafts.get(key);
    if (!draft) {
      draft = { text: "", revision: 0, pending: false };
    }
    return draft;
  }

  edit(key: string, text: string): boolean {
    // Refuse new work rather than silently evicting another thread's draft.
    const bytes = [...this.drafts.values()].reduce((sum, value) => sum + value.text.length * 2, 0);
    if ((!this.drafts.has(key) && this.drafts.size >= 32)
      || bytes - this.get(key).text.length * 2 + text.length * 2 > 2 * 1024 * 1024) return false;
    const draft = this.get(key);
    draft.text = text;
    draft.revision++;
    if (draft.text || draft.pending) this.drafts.set(key, draft);
    else this.drafts.delete(key);
    return true;
  }

  begin(key: string) {
    const draft = this.get(key);
    if (draft.pending || !draft.text.trim()) return;
    const revision = draft.revision;
    const text = draft.text.trim();
    draft.pending = true;
    return {
      text,
      finish: (accepted: boolean) => {
        draft.pending = false;
        if (accepted && draft.revision === revision) draft.text = "";
        if (!draft.text) this.drafts.delete(key);
      },
    };
  }
}
