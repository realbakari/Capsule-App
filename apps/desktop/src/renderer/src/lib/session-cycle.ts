/*
 * The conversations the sidebar shows, top to bottom, as it last drew them.
 * ⌃Tab and ⌘1–9 walk this list, so they never land on a thread the sidebar
 * hides behind a folded project, a shelf or "Show more", and they cross
 * projects in the order the person sees. Settings swaps the list for its
 * sections, so the last list drawn stays in force there.
 */
let visibleOrder: readonly string[] = [];

export function publishSidebarOrder(ids: readonly string[]): void {
  visibleOrder = ids;
}

export function sidebarOrder(): readonly string[] {
  return visibleOrder;
}

/** Thread rows in document order, each once: a thread under two tags is one stop. */
export function readSidebarOrder(root: ParentNode): string[] {
  return [...new Set(Array.from(root.querySelectorAll<HTMLElement>("[data-thread-id]"), (row) => row.dataset.threadId ?? ""))]
    .filter(Boolean);
}

/**
 * The conversation ⌃Tab moves to: the next one in the sidebar's order,
 * wrapping at the ends. From a thread the sidebar does not show, it starts at
 * the top going forward and at the bottom going back.
 */
export function adjacentSession(order: readonly string[], currentId: string | undefined, step: 1 | -1): string | undefined {
  if (order.length === 0) return undefined;
  const index = currentId === undefined ? -1 : order.indexOf(currentId);
  if (index < 0) return step === 1 ? order[0] : order.at(-1);
  return order[(index + step + order.length) % order.length];
}
