/** Bounded display facts, not instructions to execute or permission to open files. */
export interface ToolActivityDetails {
  input?: string;
  /** The output, or its first lines when it was too long to keep whole. */
  output?: string;
  /** The output's last lines, kept when the middle was dropped: errors and summaries print last. */
  outputTail?: string;
  /** Lines dropped between `output` and `outputTail`. */
  omittedLines?: number;
  /** A command's exit status, where the route reports one. */
  exitCode?: number;
  locations?: string[];
  truncated?: boolean;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const TEXT_LIMIT = 2048;
/*
 * Output keeps a short head and a longer tail. Each part stays within the
 * 2 KB a saved event keeps of any one string, or saving would cut the tail
 * back to its first 2 KB and lose the end again.
 */
const HEAD_LIMIT = 768;
const HEAD_LINES = 12;
const TAIL_LIMIT = TEXT_LIMIT;
const TAIL_LINES = 40;
/** Text blocks gathered before the split; a runaway log is not held whole. */
const READ_LIMIT = 1024 * 1024;
/* eslint-disable no-control-regex -- Strip untrusted display controls. */
const sanitize = (text: string) => text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, "");
/* eslint-enable no-control-regex */

const exitCodeOf = (value: unknown): number | undefined => typeof value === "number" && Number.isInteger(value) && Math.abs(value) < 1_000_000 ? value : undefined;

function countLines(text: string): number {
  let lines = 1;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) lines++;
  return lines;
}

/**
 * Long output keeps its first and last lines. A failing build prints the
 * error at the end, and keeping only the first 2 KB showed the compiler
 * banner and dropped the line that said what broke.
 */
export function splitToolOutput(text: string): Pick<ToolActivityDetails, "output" | "outputTail" | "omittedLines" | "truncated"> {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const total = countLines(body);
  if (body.length <= TEXT_LIMIT && total <= HEAD_LINES + TAIL_LINES) return { output: sanitize(text) };
  const head: string[] = [];
  let size = 0;
  let start = 0;
  while (head.length < HEAD_LINES && start <= body.length) {
    const end = body.indexOf("\n", start);
    const stop = end < 0 ? body.length : end;
    let line = body.slice(start, stop);
    if (head.length && size + line.length > HEAD_LIMIT) break;
    if (line.length > HEAD_LIMIT) line = line.slice(0, HEAD_LIMIT);
    head.push(line);
    size += line.length + 1;
    start = stop + 1;
  }
  const tail: string[] = [];
  size = 0;
  let finish = body.length;
  // `start` is always the beginning of a line, so the tail never splits one the head kept.
  while (tail.length < TAIL_LINES && finish >= start) {
    const begin = Math.max(body.lastIndexOf("\n", finish - 1) + 1, start);
    let line = body.slice(begin, finish);
    if (tail.length && size + line.length > TAIL_LIMIT) break;
    if (line.length > TAIL_LIMIT) line = line.slice(-TAIL_LIMIT);
    tail.unshift(line);
    size += line.length + 1;
    finish = begin - 1;
  }
  const omitted = total - head.length - tail.length;
  // No whole line to drop, only long ones (a minified file, one huge line): keep the start.
  if (omitted <= 0) return { output: sanitize(body.slice(0, TEXT_LIMIT)), truncated: true };
  return { output: sanitize(head.join("\n")), outputTail: sanitize(tail.join("\n")), omittedLines: omitted, truncated: true };
}

/** Select readable tool fields; never dump opaque objects, images or binary data into chat. */
export function readToolActivityDetails(value: unknown): ToolActivityDetails {
  const tool = record(value);
  const saved = record(tool.details);
  const details: ToolActivityDetails = {};
  // Display as literal text. Remove terminal escapes and invisible controls,
  // but do not rewrite code or interpret it as markdown/HTML.
  const clip = (text: string) => {
    if (text.length > TEXT_LIMIT) details.truncated = true;
    return sanitize(text.slice(0, TEXT_LIMIT));
  };
  const setOutput = (text: string) => Object.assign(details, splitToolOutput(text));
  const rawInput = tool.rawInput;
  const command = saved.input ?? (typeof rawInput === "string" ? rawInput : record(rawInput).command);
  if (typeof command === "string") details.input = clip(command);

  if (typeof saved.output === "string") {
    // Already split once; a saved head and tail are kept as they are.
    details.output = sanitize(saved.output.slice(0, TEXT_LIMIT));
    if (typeof saved.outputTail === "string") details.outputTail = sanitize(saved.outputTail.slice(-TAIL_LIMIT));
    if (typeof saved.omittedLines === "number" && saved.omittedLines > 0) details.omittedLines = Math.floor(saved.omittedLines);
  } else if (Array.isArray(tool.content)) {
    const blocks: string[] = [];
    let length = 0;
    if (tool.content.length > 32) details.truncated = true;
    for (const item of tool.content.slice(0, 32)) {
      const block = record(item);
      const content = record(block.content);
      if (block.type !== "content" || content.type !== "text" || typeof content.text !== "string") continue;
      blocks.push(content.text.slice(-READ_LIMIT));
      length += content.text.length + 1;
      if (length > READ_LIMIT) { details.truncated = true; break; }
    }
    // Content is a replacement snapshot, even when it contains only types we
    // cannot preview. Only omission preserves the previous displayed text.
    setOutput(blocks.join("\n"));
  }
  const raw = record(tool.rawOutput);
  if (details.output === undefined && tool.rawOutput != null) {
    const output = tool.rawOutput;
    if (typeof output === "string") setOutput(output);
    else {
      const parts = [raw.stdout, raw.stderr].filter((part): part is string => typeof part === "string");
      if (parts.length) setOutput(parts.join("\n"));
      else if (typeof raw.text === "string") setOutput(raw.text);
    }
  }
  const exitCode = exitCodeOf(saved.exitCode) ?? exitCodeOf(tool.exitCode) ?? exitCodeOf(raw.exitCode) ?? exitCodeOf(raw.exit_code);
  if (exitCode !== undefined) details.exitCode = exitCode;
  const locations = Array.isArray(saved.locations) ? saved.locations : tool.locations;
  if (Array.isArray(locations)) {
    if (locations.length > 8) details.truncated = true;
    details.locations = locations.slice(0, 8).flatMap((location) => {
      const path = typeof location === "string" ? location : record(location).path;
      // Paths are identities. Never clip or sanitize one into a different file.
      return typeof path === "string" && path.length > 0 && path.length <= 512
        /* eslint-disable-next-line no-control-regex -- Reject paths with display controls. */
        && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(path) ? [path] : [];
    });
  }
  if (saved.truncated === true || tool.payloadTruncated === true) details.truncated = true;
  return details;
}
