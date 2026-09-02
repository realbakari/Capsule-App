/** Frontmatter is loader metadata, not part of the readable skill guide. */
export function skillMarkdownBody(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)*/, "").trim();
}
