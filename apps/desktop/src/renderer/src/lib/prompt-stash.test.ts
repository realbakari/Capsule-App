import { describe, expect, it } from "vitest";
import {
  promptDraftKey,
  readPromptDraft,
  readPromptStash,
  stashPrompt,
  writePromptDraft,
  type PromptStorage,
} from "./prompt-stash";

function memoryStorage(): PromptStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("prompt stash", () => {
  it("preserves skill-only drafts and stashes without leaking into another thread", () => {
    const storage = memoryStorage();
    const value = { prompt: "", attachments: [], skillId: "global:skills:review" };
    const key = promptDraftKey("p", "one");
    writePromptDraft(storage, key, value);
    expect(readPromptDraft(storage, key)).toEqual(value);
    expect(readPromptDraft(storage, promptDraftKey("p", "two")).skillId).toBeUndefined();
    expect(stashPrompt(storage, [], value)).toHaveLength(1);
    expect(readPromptStash(storage)[0]?.skillId).toBe(value.skillId);
    writePromptDraft(storage, key, { ...value, skillId: undefined });
    expect(storage.getItem(key)).toBeNull();
  });
  it("persists drafts by project and conversation", () => {
    const storage = memoryStorage();
    const key = promptDraftKey("project", "session");
    expect(writePromptDraft(storage, key, { prompt: "hello", attachments: [] })).toBe(true);
    expect(readPromptDraft(storage, key).prompt).toBe("hello");
  });

  it("stashes and restores attachment metadata", () => {
    const storage = memoryStorage();
    const next = stashPrompt(storage, [], {
      prompt: "Review this",
      projectId: "project",
      attachments: [{ name: "notes.md", path: "/tmp/notes.md", size: 4 }],
    });
    expect(next).toHaveLength(1);
    expect(readPromptStash(storage)[0]).toMatchObject({ prompt: "Review this", projectId: "project" });
  });
});
