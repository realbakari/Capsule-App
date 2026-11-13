/**
 * Below this width — a phone paired to the desktop, or a very small window —
 * the sidebar becomes a drawer over the content instead of a column beside it.
 * Kept in step with the `max-width: 640px` block in styles.css.
 */
export const NARROW_QUERY = "(max-width: 640px)";

export function isNarrow(): boolean {
  try { return typeof matchMedia === "function" && matchMedia(NARROW_QUERY).matches; }
  catch { return false; }
}
