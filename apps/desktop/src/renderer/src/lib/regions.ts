/**
 * F6 moves focus between the window's regions: sidebar, transcript, composer,
 * side panel, in that order, skipping any that are hidden. Each region gets
 * focus on its own first control, or on itself when it has none.
 */
export const REGIONS: Array<{ name: string; selector: string; target?: string }> = [
  { name: "Sidebar", selector: ".sidebar:not([inert])", target: "[aria-current='page'], input, button" },
  { name: "Conversation", selector: ".conversation" },
  { name: "Composer", selector: ".composer-dock", target: "textarea.composer-field" },
  { name: "Side panel", selector: ".inspector", target: "button, input, [tabindex='0']" },
];

const visible = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && element.getClientRects().length > 0 && !element.closest("[hidden]");

/** The index of the region holding `active`, or -1. */
export function regionOf(active: Element | null, roots: ReadonlyArray<HTMLElement | null>): number {
  return roots.findIndex((root) => Boolean(root && active && root.contains(active)));
}

export function cycleRegion(step: 1 | -1, doc: Document = document): void {
  const roots = REGIONS.map((region) => doc.querySelector(region.selector)).map((element) => (visible(element) ? element : null));
  const current = regionOf(doc.activeElement, roots);
  for (let offset = 1; offset <= REGIONS.length; offset++) {
    const index = (current + step * offset + REGIONS.length * 2) % REGIONS.length;
    const root = roots[index];
    if (!root) continue;
    const target = REGIONS[index]!.target ? root.querySelector<HTMLElement>(REGIONS[index]!.target!) : null;
    const focusable = target && visible(target) ? target : root;
    if (focusable === root && !root.hasAttribute("tabindex")) root.tabIndex = -1;
    focusable.focus({ preventScroll: focusable === root });
    return;
  }
}
