/**
 * Turning a CLI's dying words into something worth showing someone.
 *
 * An agent that fails to start writes several lines to stderr, and only one of
 * them says what went wrong. This used to take the last line, which is the one
 * place the answer never is — a CLI prints the error first and its usage
 * footer afterwards, so the thread showed "For more information, try
 * '--help'." as though that were the problem.
 */

/*
 * Lines that are the CLI talking about itself: a usage block, a flag list, the
 * footer pointing at --help. True of every CLI, informative in none of them.
 */
const BOILERPLATE = [
  /^for more information/i,
  /^usage:/i,
  /^options:/i,
  /^commands:/i,
  /^arguments:/i,
  /^try\b.*--help/i,
  /^run .*--help/i,
  /^\s*-{1,2}[\w-]/,
  /^\s*$/,
];

/** Prefixes a CLI puts in front of the message, which the reader does not need. */
const ERROR_PREFIX = /^(?:error|fatal|err|failed)\s*(?::|\s-\s)\s*/i;

function isBoilerplate(line: string): boolean {
  return BOILERPLATE.some((pattern) => pattern.test(line));
}

/**
 * The most informative line of `stderr`, or nothing when there is none.
 *
 * A line that names itself an error wins wherever it sits; otherwise the first
 * line that is not the CLI describing its own arguments.
 */
export function readCliError(stderr: string): string | undefined {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const named = lines.find((line) => ERROR_PREFIX.test(line));
  const chosen = named ?? lines.find((line) => !isBoilerplate(line));
  if (!chosen) return undefined;
  const cleaned = chosen.replace(ERROR_PREFIX, "").trim();
  return cleaned || chosen;
}

/*
 * What to do about it, for the failures worth naming.
 *
 * Direct mode had none of this: the CLI's own words went straight to the
 * thread, so "Authentication required" arrived with no hint that it meant
 * signing in, and no clue which of several agents was asking.
 */
const GUIDANCE: Array<{ match: RegExp; advise: (name: string) => string }> = [
  {
    match: /authentication required|not (?:logged|signed) in|please run \/?login|unauthor/i,
    advise: (name) => `${name} is not signed in. Sign in to it in a terminal, then try again.`,
  },
  {
    match: /no api key|missing api key|api key not found/i,
    advise: (name) => `${name} has no API key configured. Add one, then try again.`,
  },
  {
    match: /rate limit|quota|session limit|usage limit/i,
    advise: () => "The provider is refusing more work right now. Wait, or switch agent.",
  },
  {
    match: /ENOENT|command not found|no such file or directory/i,
    advise: (name) => `${name} could not be started. Check that it is installed and on your PATH.`,
  },
  {
    match: /unexpected argument|unknown (?:option|flag)|invalid (?:option|argument)/i,
    advise: (name) =>
      `${name} did not accept the arguments Capsule used, which usually means a version mismatch. Update it, then run Doctor.`,
  },
];

/**
 * The failure, said once, with what to do about it when that is known.
 *
 * `name` is the harness as the user knows it — "Grok Build", not the binary —
 * because the thread does not otherwise say which agent is complaining.
 */
export function explainDirectFailure(message: string, name: string): string {
  const text = message.trim();
  if (!text) return `${name} stopped without saying why.`;
  const entry = GUIDANCE.find((item) => item.match.test(text));
  if (!entry) return text;
  const advice = entry.advise(name);
  // Not repeated: when the CLI's line says no more than the advice does, the
  // advice alone is the clearer of the two.
  return text.toLowerCase() === advice.toLowerCase() ? advice : `${text} — ${advice}`;
}
