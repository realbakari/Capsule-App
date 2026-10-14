import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/** Single-turn admission is owned by the session; closing also wakes an idle SDK. */
export class ClaudeInput implements AsyncIterableIterator<SDKUserMessage> {
  private pending?: (item: IteratorResult<SDKUserMessage>) => void;
  private queued?: SDKUserMessage;
  private closed = false;
  [Symbol.asyncIterator]() { return this; }
  next(): Promise<IteratorResult<SDKUserMessage>> {
    if (this.queued) { const value = this.queued; this.queued = undefined; return Promise.resolve({ value, done: false }); }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => { this.pending = resolve; });
  }
  push(value: SDKUserMessage): void {
    if (this.closed || this.queued) throw new Error("The agent cannot accept another prompt.");
    const pending = this.pending; this.pending = undefined;
    if (pending) pending({ value, done: false }); else this.queued = value;
  }
  close(): void {
    this.closed = true; this.queued = undefined;
    this.pending?.({ value: undefined, done: true }); this.pending = undefined;
  }
}
