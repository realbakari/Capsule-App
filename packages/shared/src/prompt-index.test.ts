import { describe, expect, it } from "vitest";
import { promptIndex } from "./prompt-index.js";
import type { ChatMessage } from "./types.js";

const message = (id: string, role: ChatMessage["role"], content: string): ChatMessage =>
  ({ id, sessionId: "s", role, content, createdAt: "2026-11-14T00:00:00.000Z" });

const thread = [
  message("p1", "user", "Add a login form"),
  message("r1", "assistant", "Added the login form"),
  message("p2", "user", "Make the\n  form   validate email"),
  message("p3", "user", "   "),
  message("p4", "user", "Write tests for the LOGIN flow"),
];

describe("promptIndex", () => {
  it("lists only prompts, newest first, numbered in thread order", () => {
    expect(promptIndex(thread).map((entry) => [entry.number, entry.messageId])).toEqual([[3, "p4"], [2, "p2"], [1, "p1"]]);
  });

  it("keeps every word of the query, in any order and any case", () => {
    expect(promptIndex(thread, "login").map((entry) => entry.messageId)).toEqual(["p4", "p1"]);
    expect(promptIndex(thread, "form login").map((entry) => entry.messageId)).toEqual(["p1"]);
    expect(promptIndex(thread, "  EMAIL  ").map((entry) => entry.number)).toEqual([2]);
    expect(promptIndex(thread, "nothing like this")).toEqual([]);
  });

  it("shows a prompt on one line, clipped", () => {
    expect(promptIndex(thread, "email")[0]?.text).toBe("Make the form validate email");
    const long = promptIndex([message("x", "user", "a".repeat(400))])[0]!;
    expect(long.text).toHaveLength(160);
    expect(long.text.endsWith("…")).toBe(true);
  });
});
