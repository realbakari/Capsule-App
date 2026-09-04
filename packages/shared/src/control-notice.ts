/** An exact operator acknowledgement, not agent-authored conversation. Keep
 * this narrow so an answer discussing cancellation is never suppressed. */
export function isAcpCancelNotice(text: string | undefined): boolean {
  return /^(?:✅\s*)?Cancel requested for ACP session agent:[\w-]+:acp:[\w-]+\.?$/i.test(text?.trim() ?? "");
}

/** Recognize a full status report, not prose quoting or explaining one. */
export function isAcpStatusNotice(text: string | undefined): boolean {
  const value = text?.trim() ?? "";
  return /^ACP status:\s*(?:-+\s*)?session:\s*agent:[\w-]+:acp:[\w-]+\b/i.test(value)
    && /\bbackend:\s*\S+/i.test(value)
    && /\b(?:sessionMode|state|runtimeDetails):/i.test(value);
}
