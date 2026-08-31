/*
 * Splitting a reply into prose and fenced code.
 *
 * `content.split(/```(\w+)?\n?/)` puts a capture slot at every odd index — one
 * for the opening fence and one for the closing fence — so a single closed
 * block yields five parts, not four:
 *
 *   "A\n```ts\ncode\n```\nB"  ->  ["A\n", "ts", "code\n", undefined, "B"]
 *
 * Even indices hold the content and alternate prose, code, prose, code…, and a
 * block's language is the capture immediately before it. Treating the array as
 * repeating triples mis-indexes everything after the first block and hands
 * `undefined` to the prose renderer.
 */
export interface FenceSegment {
  kind: "prose" | "code";
  text: string;
  language?: string;
}

const FENCE = /```(\w+)?\n?/;

export function splitFences(content: string): FenceSegment[] {
  const parts = content.split(FENCE);
  const segments: FenceSegment[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const text = parts[index];
    if (text === undefined) continue;
    const isCode = (index / 2) % 2 === 1;
    if (!isCode) {
      if (text) segments.push({ kind: "prose", text });
      continue;
    }
    const language = parts[index - 1];
    segments.push({
      kind: "code",
      text: text.replace(/\n$/, ""),
      ...(language ? { language } : {}),
    });
  }
  return segments;
}
