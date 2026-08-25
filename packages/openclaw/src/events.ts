export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function compactParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

export function extractGatewayText(payload: Record<string, unknown>): string {
  const delta = asString(payload.deltaText);
  if (delta) return delta;
  const text = asString(payload.text);
  if (text) return text;
  const error = asString(payload.errorMessage);
  if (error) return error;
  const summary = asString(payload.summary);
  if (summary) return summary;
  const message = payload.message;
  if (typeof message === "string") return message;
  if (message && typeof message === "object") {
    const record = asRecord(message);
    const content = record.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          const item = asRecord(part);
          return asString(item.text, asString(item.content));
        })
        .filter(Boolean)
        .join("");
    }
    return asString(record.text);
  }
  return "";
}

export function isGatewayTurnDone(payload: Record<string, unknown>): boolean {
  const state = asString(payload.state);
  const status = asString(payload.status);
  const phase = asString(payload.phase);
  return (
    state === "final" ||
    state === "aborted" ||
    state === "error" ||
    status === "ok" ||
    status === "error" ||
    phase === "end" ||
    phase === "error"
  );
}

const ACP_FAIL = [
  "runtime backend is not configured",
  "acp is disabled",
  "is not allowed by policy",
  "unable to resolve session",
  "sandboxed sessions cannot spawn",
  "permissionpromptunavailable",
  "unknown command",
  "failed to spawn",
  "harness command not found",
];

export function acpCommandFailed(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined;
  const lower = text.toLowerCase();
  if (ACP_FAIL.some((needle) => lower.includes(needle))) return text.trim();
  return undefined;
}
