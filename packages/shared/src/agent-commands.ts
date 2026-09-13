import { sanitizeUntrusted } from "./untrusted.js";

export interface AgentCommand { name: string; description: string; inputHint?: string }

function label(value: string, limit: number): string {
  // Bound work before normalization; reserve room for the truncation suffix.
  return sanitizeUntrusted(value.slice(0, limit * 2), { maxChars: limit - 13, singleLine: true });
}

/** Commands are session-owned protocol data, never executable client code. */
export function readAgentCommands(value: unknown): AgentCommand[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const commands = new Map<string, AgentCommand>();
  for (const item of value.slice(0, 64)) {
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; description?: unknown; input?: { hint?: unknown } };
    if (typeof row.name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,127}$/.test(row.name)) continue;
    const description = typeof row.description === "string" ? label(row.description, 256) : "";
    const inputHint = typeof row.input?.hint === "string" ? label(row.input.hint, 128) : undefined;
    commands.set(row.name, { name: row.name, description, inputHint });
  }
  return [...commands.values()];
}
