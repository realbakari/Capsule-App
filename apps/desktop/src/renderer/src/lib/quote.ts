/** Selected reply text as a Markdown quote, one `>` per line, trailing blanks dropped. */
export function quoteMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "").split("\n");
  return lines.map((line) => (line.trim() ? `> ${line}` : ">")).join("\n");
}
