/** Bounded display facts, not instructions to execute or permission to open files. */
export interface ToolActivityDetails {
  input?: string;
  output?: string;
  locations?: string[];
  truncated?: boolean;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const TEXT_LIMIT = 2048;

/** Select readable tool fields; never dump opaque objects, images or binary data into chat. */
export function readToolActivityDetails(value: unknown): ToolActivityDetails {
  const tool = record(value);
  const saved = record(tool.details);
  const details: ToolActivityDetails = {};
  const clip = (text: string) => {
    if (text.length > TEXT_LIMIT) details.truncated = true;
    // Display as literal text. Remove terminal escapes and invisible controls,
    // but do not rewrite code or interpret it as markdown/HTML.
    /* eslint-disable no-control-regex -- Strip untrusted display controls. */
    return text.slice(0, TEXT_LIMIT).replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, "");
    /* eslint-enable no-control-regex */
  };
  const rawInput = tool.rawInput;
  const command = saved.input ?? (typeof rawInput === "string" ? rawInput : record(rawInput).command);
  if (typeof command === "string") details.input = clip(command);

  if (typeof saved.output === "string") details.output = clip(saved.output);
  else if (Array.isArray(tool.content)) {
    const blocks: string[] = [];
    let length = 0;
    if (tool.content.length > 32) details.truncated = true;
    for (const item of tool.content.slice(0, 32)) {
      const block = record(item);
      const content = record(block.content);
      if (block.type !== "content" || content.type !== "text" || typeof content.text !== "string") continue;
      blocks.push(content.text.slice(0, TEXT_LIMIT + 1));
      length += content.text.length + 1;
      if (length > TEXT_LIMIT) { details.truncated = true; break; }
    }
    // Content is a replacement snapshot, even when it contains only types we
    // cannot preview. Only omission preserves the previous displayed text.
    details.output = clip(blocks.join("\n"));
  }
  if (details.output === undefined && tool.rawOutput != null) {
    const output = tool.rawOutput;
    if (typeof output === "string") details.output = clip(output);
    else {
      const row = record(output);
      const parts = [row.stdout, row.stderr].filter((part): part is string => typeof part === "string");
      if (parts.length) details.output = clip(parts.map((part) => clip(part)).join("\n"));
      else if (typeof row.text === "string") details.output = clip(row.text);
    }
  }
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
