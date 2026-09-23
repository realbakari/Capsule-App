import type { ChannelMember } from "@capsule/shared";

export interface DraftMention { start: number; end: number; pubkey: string; text: string }
export const mentionLabel = (member: ChannelMember) => `@${member.name.replace(/\s+/g, " ").trim()}`;

/** Preserve identity only while the selected text remains intact. Edits inside
 * a token invalidate it; inserting/removing text before it shifts its range. */
export function editMentions(before: string, after: string, mentions: DraftMention[]): DraftMention[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = before.length, nextEnd = after.length;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
  const delta = after.length - before.length;
  return mentions.flatMap((mention) => {
    const shifted = mention.end <= start ? mention : mention.start >= end ? { ...mention, start: mention.start + delta, end: mention.end + delta } : undefined;
    return shifted && after.slice(shifted.start, shifted.end) === shifted.text
      && !/[\p{L}\p{N}_@]/u.test(after[shifted.start - 1] ?? "")
      && !/[\p{L}\p{N}_]/u.test(after[shifted.end] ?? "") ? [shifted] : [];
  });
}

export function mentionQuery(content: string, caret: number): { start: number; query: string } | undefined {
  const prefix = content.slice(0, caret);
  const match = /(?:^|\s)@([^@\n]{0,80})$/.exec(prefix);
  if (!match || match[1]!.includes("  ")) return;
  return { start: caret - match[1]!.length - 1, query: match[1]! };
}

/** Only decorate unambiguous names explicitly tagged by the message author. */
export function mentionedText(text: string, members: ChannelMember[], pubkeys: string[]) {
  const eligible = members.filter((member) => pubkeys.includes(member.pubkey) && members.filter((other) => mentionLabel(other) === mentionLabel(member)).length === 1);
  const labels = eligible.map(mentionLabel).sort((a, b) => b.length - a.length);
  const parts: Array<{ text: string; member?: ChannelMember }> = [];
  let cursor = 0, plain = 0;
  while (cursor < text.length) {
    const label = (cursor === 0 || !/[\p{L}\p{N}_@]/u.test(text[cursor - 1]!))
      ? labels.find((label) => text.startsWith(label, cursor) && !/[\p{L}\p{N}_]/u.test(text[cursor + label.length] ?? "")) : undefined;
    if (!label) { cursor++; continue; }
    if (cursor > plain) parts.push({ text: text.slice(plain, cursor) });
    parts.push({ text: label, member: eligible.find((member) => mentionLabel(member) === label) });
    cursor += label.length; plain = cursor;
  }
  if (plain < text.length) parts.push({ text: text.slice(plain) });
  return parts;
}
