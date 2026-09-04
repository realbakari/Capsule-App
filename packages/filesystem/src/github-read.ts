export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type ReadCommand = (
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
) => Promise<CommandResult>;

export const INCOMPLETE_GITHUB_RESPONSE =
  "GitHub returned an incomplete response. Try refreshing again in a moment.";

/** Both gh's Go decoder and JavaScript decoders can report a cut-off response. */
export function isIncompleteResponse(text: string): boolean {
  return /unexpected (?:end of (?:JSON input|input)|EOF)|invalid JSON|empty response/i.test(text);
}

/**
 * Retry only idempotent JSON reads, once. A failed decode is not an empty list.
 * The whole operation shares one timeout budget, including the retry.
 */
export async function readGhJson<T>(
  args: string[],
  cwd: string,
  decode: (raw: string) => T | undefined,
  run: ReadCommand,
  timeout = 30_000,
): Promise<{ value: T; error?: never } | { value?: never; error: string }> {
  if (args[0] !== "pr" || (args[1] !== "list" && args[1] !== "view")) {
    throw new Error("Automatic retries are restricted to pull request reads.");
  }
  const deadline = Date.now() + timeout;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await run("gh", args, cwd, Math.max(1, deadline - Date.now()));
    const value = result.ok ? decode(result.stdout) : undefined;
    if (value !== undefined) return { value };
    const incomplete = result.ok || isIncompleteResponse(result.stderr);
    const transient = incomplete || /HTTP 50[234]|unexpected EOF/i.test(result.stderr);
    if (attempt === 0 && transient && deadline - Date.now() > 500) continue;
    return {
      error: incomplete
        ? INCOMPLETE_GITHUB_RESPONSE
        : result.stderr || "GitHub could not be read. Try refreshing again.",
    };
  }
  return { error: INCOMPLETE_GITHUB_RESPONSE };
}
