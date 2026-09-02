import type { MessageAttachment } from "@capsule/shared";

export const PROMPT_STASH_KEY = "capsule.promptStash.v1";
export const PROMPT_DRAFT_PREFIX = "capsule.promptDraft.v1";
export const MAX_PROMPT_STASH_ENTRIES = 20;

export interface PromptDraft {
  prompt: string;
  attachments: MessageAttachment[];
}

export interface PromptStashEntry extends PromptDraft {
  id: string;
  createdAt: string;
  projectId?: string;
}

export interface PromptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function attachment(value: unknown): value is MessageAttachment {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<MessageAttachment>;
  return (
    typeof row.name === "string" &&
    typeof row.path === "string" &&
    typeof row.size === "number" &&
    Number.isFinite(row.size)
  );
}

function draft(value: unknown): PromptDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Partial<PromptDraft>;
  if (typeof row.prompt !== "string" || !Array.isArray(row.attachments)) return undefined;
  return { prompt: row.prompt, attachments: row.attachments.filter(attachment).slice(0, 8) };
}

export function promptDraftKey(projectId?: string, sessionId?: string): string {
  return `${PROMPT_DRAFT_PREFIX}:${projectId ?? "none"}:${sessionId ?? "new"}`;
}

export function readPromptDraft(storage: PromptStorage, key: string): PromptDraft {
  try {
    return draft(JSON.parse(storage.getItem(key) ?? "null")) ?? { prompt: "", attachments: [] };
  } catch {
    return { prompt: "", attachments: [] };
  }
}

export function writePromptDraft(storage: PromptStorage, key: string, value: PromptDraft): boolean {
  try {
    if (!value.prompt && value.attachments.length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readPromptStash(storage: PromptStorage): PromptStashEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PROMPT_STASH_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const entries: PromptStashEntry[] = [];
    for (const value of parsed) {
      const base = draft(value);
      const row = value as Partial<PromptStashEntry>;
      if (!base || typeof row.id !== "string" || typeof row.createdAt !== "string") continue;
      entries.push({
        ...base,
        id: row.id,
        createdAt: row.createdAt,
        ...(typeof row.projectId === "string" ? { projectId: row.projectId } : {}),
      });
      if (entries.length >= MAX_PROMPT_STASH_ENTRIES) break;
    }
    return entries;
  } catch {
    return [];
  }
}

export function writePromptStash(storage: PromptStorage, entries: PromptStashEntry[]): boolean {
  try {
    storage.setItem(PROMPT_STASH_KEY, JSON.stringify(entries.slice(0, MAX_PROMPT_STASH_ENTRIES)));
    return true;
  } catch {
    return false;
  }
}

export function stashPrompt(
  storage: PromptStorage,
  current: PromptStashEntry[],
  value: PromptDraft & { projectId?: string },
): PromptStashEntry[] {
  if (!value.prompt.trim() && value.attachments.length === 0) return current;
  const entry: PromptStashEntry = {
    ...value,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const next = [entry, ...current].slice(0, MAX_PROMPT_STASH_ENTRIES);
  return writePromptStash(storage, next) ? next : current;
}
