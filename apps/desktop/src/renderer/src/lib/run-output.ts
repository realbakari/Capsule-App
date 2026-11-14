/**
 * What a hook, status line or command shell printed, as the doctor shows it:
 * a unified diff goes to the diff viewer, anything else is Markdown, which
 * Capsule's renderer draws without ever rendering HTML.
 */
export function isUnifiedDiff(text: string): boolean {
  return /^diff --git /m.test(text) || (/^--- \S/m.test(text) && /^\+\+\+ \S/m.test(text) && /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m.test(text));
}
