export const CHANNEL_FORMATS = {
  Bold: ["**", "**", "bold text"], Italic: ["_", "_", "italic text"],
  Strikethrough: ["~~", "~~", "text"], "Inline code": ["`", "`", "code"],
  "Code block": ["\n```\n", "\n```\n", "code"], Link: ["[", "](https://)", "link text"],
  "Bullet list": ["\n- ", "", "item"], "Numbered list": ["\n1. ", "", "item"], Quote: ["\n> ", "", "quote"],
} as const;
export type ChannelFormat = keyof typeof CHANNEL_FORMATS;

export function formatChannelSelection(content: string, start: number, end: number, kind: ChannelFormat) {
  const [prefix, suffix, placeholder] = CHANNEL_FORMATS[kind];
  const selected = content.slice(start, end) || placeholder;
  // Two insertions allow selected identity spans to keep their offsets.
  const before = content.slice(0, end) + suffix + content.slice(end);
  const after = before.slice(0, start) + prefix + (start === end ? selected : "") + before.slice(start);
  return { before, content: after, start: start + prefix.length, end: start + prefix.length + selected.length };
}
