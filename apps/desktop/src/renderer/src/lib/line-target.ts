/** Where a 1-based line sits in text, as character offsets; nothing past the last line. */
export function lineSpan(text: string, line: number): { start: number; end: number } | undefined {
  if (!Number.isInteger(line) || line < 1) return undefined;
  let start = 0;
  for (let current = 1; current < line; current++) {
    const next = text.indexOf("\n", start);
    if (next < 0) return undefined;
    start = next + 1;
  }
  if (start > text.length || (start === text.length && line > 1 && !text.endsWith("\n"))) return undefined;
  const end = text.indexOf("\n", start);
  return { start, end: end < 0 ? text.length : end };
}

/** A DOM range over one line of a highlighted block, whose text is split across token spans. */
export function rangeForLine(root: Node, line: number): Range | undefined {
  const span = lineSpan(root.textContent ?? "", line);
  if (!span) return undefined;
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && span.start <= offset + length) { range.setStart(node, span.start - offset); started = true; }
    if (started && span.end <= offset + length) { range.setEnd(node, span.end - offset); return range; }
    offset += length;
  }
  return started ? range : undefined;
}
