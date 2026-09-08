import { expect, it } from "vitest";
import type { ChatMessage, Run } from "@capsule/shared";
import { boundTranscript, MAX_TRANSCRIPT_BYTES, retainRunReceipts } from "./transcript-window";

const messages: ChatMessage[] = Array.from({ length: 2000 }, (_, index) => ({
  id: String(index), sessionId: "thread", role: "user", content: "x".repeat(10000),
  runId: `run-${index}`, createdAt: new Date(index * 1000).toISOString(),
}));

it("bounds bytes and count at either edge without mutating saved history", () => {
  for (const edge of ["oldest", "newest"] as const) {
    const page = boundTranscript(messages, edge);
    expect(page.trimmed).toBe(true);
    expect(page.messages.length).toBeLessThanOrEqual(300);
    expect(page.bytes).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES);
    expect(edge === "oldest" ? page.messages[0]?.id : page.messages.at(-1)?.id).toBe(edge === "oldest" ? "0" : "1999");
  }
  expect(messages).toHaveLength(2000);
});

it("labels oversized display excerpts without changing their persisted input", () => {
  const message = { ...messages[0]!, content: "x".repeat(100000) };
  const page = boundTranscript([message], "newest");
  expect(page.messages[0]).toMatchObject({ contentTruncated: true });
  expect(page.messages[0]?.content.length).toBe(65536);
  expect(message.content).toHaveLength(100000);
});

it("keeps old run receipts with their displayed messages and a bounded live tail", () => {
  const runs = [...messages].reverse().map((message) => ({ id: message.runId!, createdAt: message.createdAt })) as Run[];
  const retained = retainRunReceipts(runs, messages.slice(0, 60));
  expect(retained).toHaveLength(160);
  expect(retained.some((run) => run.id === "run-0")).toBe(true);
  expect(retained.some((run) => run.id === "run-1999")).toBe(true);
});
