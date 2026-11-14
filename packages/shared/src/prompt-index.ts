import type { ChatMessage } from "./types.js";

/** One prompt in a thread, as the jump list shows it. */
export interface PromptIndexEntry {
  messageId: string;
  /** 1-based position among the thread's loaded prompts; stays put while filtering. */
  number: number;
  /** The prompt on one line, clipped for display. */
  text: string;
  createdAt: string;
}

const DISPLAY_LIMIT = 160;

/**
 * The thread's prompts, newest first, that contain every word of the query in
 * any order. An empty query lists them all.
 */
export function promptIndex(messages: readonly ChatMessage[], query = ""): PromptIndexEntry[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  const prompts = messages.filter((message) => message.role === "user" && message.content.trim());
  const entries: PromptIndexEntry[] = [];
  prompts.forEach((message, index) => {
    const haystack = message.content.toLowerCase();
    if (!words.every((word) => haystack.includes(word))) return;
    const line = message.content.replace(/\s+/gu, " ").trim();
    entries.push({
      messageId: message.id,
      number: index + 1,
      text: line.length > DISPLAY_LIMIT ? `${line.slice(0, DISPLAY_LIMIT - 1)}…` : line,
      createdAt: message.createdAt,
    });
  });
  return entries.reverse();
}
