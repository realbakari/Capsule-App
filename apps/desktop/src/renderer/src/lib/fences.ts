/* Fenced code is kept separate from Markdown and HTML normalization, including
   tilde fences, longer fences around examples, and incomplete streaming blocks. */
export interface FenceSegment {
  kind: "prose" | "code";
  text: string;
  language?: string;
}

interface CodeFence {
  start: number;
  bodyStart: number;
  bodyEnd: number;
  end: number;
  language?: string;
}

/** Fences start on a line; a shorter fence inside a code example is literal. */
export function codeFences(content: string): CodeFence[] {
  const opener = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n|$)/gm;
  const fences: CodeFence[] = [];
  let match: RegExpExecArray | null;
  while ((match = opener.exec(content))) {
    const fence = match[1]!;
    const info = match[2]!.trim();
    if (fence[0] === "`" && info.includes("`")) continue;
    const bodyStart = opener.lastIndex;
    const closer = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\r?\\n|$)`, "gm");
    closer.lastIndex = bodyStart;
    const closing = closer.exec(content);
    const end = closing ? closer.lastIndex : content.length;
    const language = info.split(/\s+/)[0] || undefined;
    fences.push({ start: match.index, bodyStart, bodyEnd: closing?.index ?? content.length, end, language });
    opener.lastIndex = end;
    if (!closing) break;
  }
  return fences;
}

export function splitFences(content: string): FenceSegment[] {
  const segments: FenceSegment[] = [];
  let consumed = 0;
  for (const fence of codeFences(content)) {
    if (fence.start > consumed) segments.push({ kind: "prose", text: content.slice(consumed, fence.start) });
    segments.push({
      kind: "code",
      text: content.slice(fence.bodyStart, fence.bodyEnd).replace(/\r?\n$/, ""),
      ...(fence.language ? { language: fence.language } : {}),
    });
    consumed = fence.end;
  }
  if (consumed < content.length) segments.push({ kind: "prose", text: content.slice(consumed) });
  return segments;
}
