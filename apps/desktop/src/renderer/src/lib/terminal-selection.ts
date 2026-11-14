/*
 * Terminal text handed to the composer.
 *
 * A selection becomes a fenced block named after the shell tab it came from,
 * so the agent can tell output from prose and the person can tell two shells
 * apart. A long selection keeps its end, which is where a command reports what
 * went wrong, and says how much was left out.
 */

export const SELECTION_MAX_LINES = 200;
export const SELECTION_MAX_CHARS = 12_000;

export interface TerminalSnippet {
  text: string;
  /** Lines left out from the start, 0 when the selection fit. */
  omittedLines: number;
}

export function terminalSnippet(selection: string, label: string): TerminalSnippet | undefined {
  const lines = selection.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length) return undefined;

  let kept = lines.slice(-SELECTION_MAX_LINES);
  while (kept.length > 1 && kept.join("\n").length > SELECTION_MAX_CHARS) kept = kept.slice(1);
  let body = kept.join("\n");
  if (body.length > SELECTION_MAX_CHARS) body = body.slice(-SELECTION_MAX_CHARS);
  const omittedLines = lines.length - kept.length;

  const longestTicks = Math.max(0, ...Array.from(body.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestTicks + 1));
  const note = omittedLines > 0
    ? `\n(Trimmed: the first ${omittedLines.toLocaleString("en-US")} of ${lines.length.toLocaleString("en-US")} selected lines are left out.)`
    : body.length < kept.join("\n").length ? "\n(Trimmed: the selection was cut to its last 12,000 characters.)" : "";
  return { text: `Terminal output from ${label}:\n${fence}text\n${body}\n${fence}${note}`, omittedLines };
}

/**
 * Puts `block` into `draft` at `caret` as its own paragraph and returns where
 * the caret goes next: just after the block, ready to type the question.
 */
export function insertBlock(draft: string, caret: number, block: string): { draft: string; caret: number } {
  const at = Math.max(0, Math.min(caret, draft.length));
  const before = draft.slice(0, at);
  const after = draft.slice(at);
  const lead = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${before}${lead}${block}${tail}`;
  return { draft: `${inserted}${after}`, caret: inserted.length };
}
