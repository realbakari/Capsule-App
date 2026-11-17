import type { ActionMenuItem } from "../../lib/action-menu";

export type LinkAction = "open" | "system" | "copy";

/**
 * The system browser. In the desktop app the main process routes a new
 * window for a web or mail address to the system's handler and refuses the
 * rest; in a browser on a paired device it is a new tab there. Neither needs
 * a write channel, so a read-only device keeps it.
 */
export function openInSystemBrowser(href: string): void {
  window.open(href, "_blank", "noopener");
}

/** A reply link's menu. Without the browser panel, Open already is the system browser. */
export function linkMenuItems(panel: boolean): ActionMenuItem[] {
  return [
    { id: "open", label: "Open", icon: "link" },
    ...(panel ? [{ id: "system", label: "Open in system browser" }] : []),
    { id: "copy", label: "Copy link", icon: "copy", separatorBefore: true },
  ];
}

/** `open` is how a plain click opens the link where this view runs; `system` always leaves for the system browser. */
export async function runLinkAction(action: string, href: string, open: (href: string) => void): Promise<void> {
  if (action === "copy") await navigator.clipboard.writeText(href);
  else if (action === "open") open(href);
  else if (action === "system") openInSystemBrowser(href);
}
