import type { ChatMessage } from "@capsule/shared";

/**
 * A conversation as Markdown, for pasting into an issue, a review or another
 * agent. Speakers are headings; attachments are named, never inlined; system
 * bookkeeping is left out because it was never part of the conversation.
 */
export function conversationMarkdown(title: string, messages: readonly ChatMessage[]): string {
  const parts = [`# ${title.trim() || "Conversation"}`];
  for (const message of messages) {
    if (message.role === "system") continue;
    const speaker = message.role === "user" ? (message.kind === "steer" ? "You (steer)" : "You") : "Agent";
    const body = message.content.trim();
    const files = (message.attachments ?? []).map((item) => `- ${item.name}`).join("\n");
    const truncated = message.contentTruncated ? "\n\n_(excerpt; the full message is in Capsule)_" : "";
    parts.push(`## ${speaker}\n\n${body}${truncated}${files ? `\n\nAttached:\n${files}` : ""}`);
  }
  return `${parts.join("\n\n")}\n`;
}
