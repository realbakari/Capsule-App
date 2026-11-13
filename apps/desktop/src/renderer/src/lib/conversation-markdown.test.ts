import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@capsule/shared";
import { conversationMarkdown } from "./conversation-markdown";

const message = (role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id: content, sessionId: "s", role, content, createdAt: "", ...extra });

describe("conversation as Markdown", () => {
  it("names speakers, lists attachments and skips system lines", () => {
    const text = conversationMarkdown("Fix login", [
      message("user", "Why does login fail?", { attachments: [{ name: "log.txt", path: "/x/log.txt" }] as ChatMessage["attachments"] }),
      message("system", "bookkeeping"),
      message("assistant", "The token expired."),
      message("user", "Also check refresh", { kind: "steer" }),
    ]);
    expect(text).toBe("# Fix login\n\n## You\n\nWhy does login fail?\n\nAttached:\n- log.txt\n\n## Agent\n\nThe token expired.\n\n## You (steer)\n\nAlso check refresh\n");
  });
});
