/** Asks the browser pane to open its find bar; the workspace's ⌘F sends it when focus is in the pane. */
export const BROWSER_FIND_EVENT = "capsule:browser-find";

/** "3 of 12", "No matches", or nothing before the first result. */
export function findSummary(result: { activeMatchOrdinal: number; matches: number } | undefined, query: string): string {
  if (!query.trim() || !result) return "";
  if (result.matches === 0) return "No matches";
  return `${result.activeMatchOrdinal} of ${result.matches}`;
}
