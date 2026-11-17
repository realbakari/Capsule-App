const SHELL_LANGUAGES = new Set(["sh", "bash", "zsh", "fish", "shell", "console", "terminal"]);
/* eslint-disable-next-line no-control-regex -- Refuse text that would steer a shell beyond the visible line. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;

/** A fence's text as it should be copied: without the newline that closes its last line. */
export function fenceText(code: string): string {
  return code.replace(/\r?\n$/u, "");
}

/**
 * The command a closed shell fence offers to the terminal, or nothing. Only
 * one visible line qualifies: a second line, a control character or a bidi
 * override could make what reaches the shell differ from what the person read.
 */
export function terminalCommandFrom(code: string, language: string | undefined, closed: boolean): string | undefined {
  if (!closed || !SHELL_LANGUAGES.has(language?.toLowerCase() ?? "")) return undefined;
  const line = fenceText(code).trim().replace(/^\$\s+/u, "");
  if (!line || line.length > 1000 || CONTROL.test(line)) return undefined;
  return line;
}
