export const REPLY_BYTE_LIMIT = 1024 * 1024;
export const ACTIVE_REPLY_BYTE_LIMIT = 8 * REPLY_BYTE_LIMIT;
export const OUTPUT_LIMIT_ERROR = "Agent output exceeded Capsule's reply limit. Cancellation was requested; the saved reply may be incomplete.";

interface TextPart { text: string; bytes: number }
interface TextEntry { parts: TextPart[]; bytes: number }

/** One budget covers every retained reply, including incomplete snapshots. */
export class TextBudget {
  private readonly entries = new Map<string, TextEntry>();
  private bytes = 0;

  constructor(
    readonly perReplyLimit = REPLY_BYTE_LIMIT,
    readonly totalLimit = ACTIVE_REPLY_BYTE_LIMIT,
    readonly entryLimit = 128,
  ) {}

  get retainedBytes(): number { return this.bytes; }
  sizeOf(key: string): number { return this.entries.get(key)?.bytes ?? 0; }

  append(key: string, text: string, replace = false): void {
    // Avoid allocating an encoded copy of a clearly oversized snapshot.
    if (text.length > this.perReplyLimit) throw new Error(OUTPUT_LIMIT_ERROR);
    const bytes = new TextEncoder().encode(text).byteLength;
    const previous = this.entries.get(key);
    const oldBytes = previous?.bytes ?? 0;
    const nextBytes = (replace ? 0 : oldBytes) + bytes;
    if (nextBytes > this.perReplyLimit || this.bytes - oldBytes + nextBytes > this.totalLimit ||
      (!previous && bytes > 0 && this.entries.size >= this.entryLimit)) {
      throw new Error(OUTPUT_LIMIT_ERROR);
    }
    if (replace) this.delete(key);
    if (!bytes) return;
    const entry = this.entries.get(key) ?? { parts: [], bytes: 0 };
    let part = { text, bytes };
    // Merge similarly sized segments. Tiny deltas cannot create millions of
    // array entries or copy the entire answer on every append.
    while (entry.parts.length && entry.parts[entry.parts.length - 1]!.bytes <= part.bytes) {
      const left = entry.parts.pop()!;
      part = { text: left.text + part.text, bytes: left.bytes + part.bytes };
    }
    entry.parts.push(part);
    entry.bytes += bytes;
    this.bytes += bytes;
    this.entries.set(key, entry);
  }

  text(key: string): string { return this.entries.get(key)?.parts.map((part) => part.text).join("") ?? ""; }
  take(key: string): string { const text = this.text(key); this.delete(key); return text; }
  delete(key: string): void {
    this.bytes -= this.entries.get(key)?.bytes ?? 0;
    this.entries.delete(key);
  }
  clear(): void { this.entries.clear(); this.bytes = 0; }
}
