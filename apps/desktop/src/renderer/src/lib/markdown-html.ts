/*
 * Markdown written for GitHub carries HTML that Capsule's renderer does not
 * speak. A pull-request body arrives with bot metadata in comments and the odd
 * inline tag; printed literally, a review comment opens with
 * `<!-- macroscope-meta: {"kind":"approvability"} -->` and closes with a raw
 * `<sup>` — plumbing the reader was never meant to see.
 */

/** Tags whose text is worth keeping and whose markup is not. */
const INLINE_TAGS = /<\/?(?:sup|sub|br|kbd|small|em|strong|b|i|u|span|p|div|details|summary)(?:\s[^>]*)?\/?>/gi;

/** Drop HTML comments, including the multi-line ones bots leave behind. */
export function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n");
}

/** Drop the markup of simple inline tags, keeping what they wrapped. */
export function stripInlineTags(text: string): string {
  return text.replace(INLINE_TAGS, "");
}
