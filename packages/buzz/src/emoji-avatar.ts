/** Decode only fixed emoji artwork, never render publisher SVG. Return inert
 * text and a hex color; scripts, CSS, entities and URLs cannot cross here. */
export function emojiAvatar(picture: string | undefined): { emoji: string; color: string } | undefined {
  const prefix = "data:image/svg+xml,";
  if (!picture?.startsWith(prefix) || picture.length > 8192) return;
  let svg: string;
  try { svg = decodeURIComponent(picture.slice(prefix.length)); } catch { return; }
  const match = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512"(?: rx="(?:112|256)")? fill="(#[a-fA-F0-9]{6})"\/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-size="258">([^<>&]{1,64})<\/text><\/svg>$/.exec(svg);
  if (!match) return;
  const emoji = match[2]!;
  if (!/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(emoji)
    || !/^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u200d|\ufe0f|\u20e3|[\u{e0020}-\u{e007f}0-9#*])+$/u.test(emoji)) return;
  return { emoji, color: match[1]! };
}
