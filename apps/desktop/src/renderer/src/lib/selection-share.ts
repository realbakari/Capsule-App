import { resolvedContext, selectionLabel, selectionToMarkdown, type ResolvedContext, type SharedSelection } from "@capsule/shared";

/**
 * "Send selection to thread" from the terminal, a file preview or the browser.
 *
 * Each surface knows how to read its own selection: xterm keeps it outside the
 * DOM, a webview keeps it in another process, a file preview has line numbers
 * to work out. Surfaces register a reader here, and the command palette asks
 * the one the user touched last. Opening the palette moves focus, so asking
 * the DOM at that moment would find nothing.
 */
type Reader = () => SharedSelection | undefined | Promise<SharedSelection | undefined>;

const readers = new Map<SharedSelection["origin"], Reader>();
let lastTouched: SharedSelection["origin"] | undefined;

export function registerSelectionReader(origin: SharedSelection["origin"], read: Reader): () => void {
  readers.set(origin, read);
  return () => { if (readers.get(origin) === read) readers.delete(origin); };
}

/** Call on pointer or focus inside a surface, so the palette knows which selection the user means. */
export function touchSelectionSurface(origin: SharedSelection["origin"]): void {
  lastTouched = origin;
}

export async function currentSelection(): Promise<SharedSelection | undefined> {
  const order = [...new Set([lastTouched, "file", "terminal", "browser"] as const)].filter((origin): origin is SharedSelection["origin"] => Boolean(origin));
  for (const origin of order) {
    const read = readers.get(origin);
    if (!read) continue;
    try {
      const selection = await read();
      if (selection?.text.trim()) return selection;
    } catch { /* A surface that cannot answer has nothing selected. */ }
  }
  return undefined;
}

export const NO_SELECTION = "Select text in the terminal, a file preview or the browser first.";

export function selectionContext(selection: SharedSelection): ResolvedContext {
  return resolvedContext("selection", selectionLabel(selection), selectionToMarkdown(selection),
    selection.origin === "browser" ? selection.url : selection.origin === "terminal" ? "Terminal" : undefined);
}
