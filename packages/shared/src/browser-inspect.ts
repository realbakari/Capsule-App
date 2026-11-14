/**
 * The Browser page's inspect mode and device sizes.
 *
 * `cssSelectorFor` runs inside the inspected page: the picker script is built
 * from its source text, so it must stay self-contained (no imports, no helpers
 * outside its body).
 */

export type BrowserDeviceId = "responsive" | "iphone" | "ipad" | "desktop";

export interface BrowserDevice {
  id: BrowserDeviceId;
  label: string;
  /** CSS pixels. Responsive has none: the page fills the panel. */
  width?: number;
  height?: number;
  /** Device pixel ratio the page sees. Responsive keeps the display's own. */
  scale?: number;
  mobile: boolean;
}

export const BROWSER_DEVICES: readonly BrowserDevice[] = [
  { id: "responsive", label: "Responsive", mobile: false },
  { id: "iphone", label: "iPhone", width: 393, height: 852, scale: 3, mobile: true },
  { id: "ipad", label: "iPad", width: 820, height: 1180, scale: 2, mobile: true },
  { id: "desktop", label: "Desktop", width: 1440, height: 900, scale: 1, mobile: false },
];

export function browserDevice(id: unknown): BrowserDevice | undefined {
  return BROWSER_DEVICES.find((device) => device.id === id);
}

/** "iPhone · 393 × 852 @3x", or the measured panel size for Responsive. */
export function browserDeviceLabel(device: BrowserDevice, measured?: { width: number; height: number }): string {
  const size = device.width && device.height ? { width: device.width, height: device.height } : measured;
  if (!size) return device.label;
  const scale = device.scale ? ` @${device.scale}x` : "";
  return `${device.label} · ${Math.round(size.width)} × ${Math.round(size.height)}${scale}`;
}

/** Just enough of a DOM element for selector generation. */
export interface SelectorNode {
  tagName: string;
  id: string;
  classList: ArrayLike<string>;
  parentElement: SelectorNode | null;
  children: ArrayLike<SelectorNode>;
}

/**
 * A selector that matches `node` alone: its id when that is unique, then tag
 * and up to two classes, then a path of `:nth-of-type` steps up to the nearest
 * ancestor with a unique id. `count` is `document.querySelectorAll(s).length`.
 */
export function cssSelectorFor(
  node: SelectorNode,
  count: (selector: string) => number,
  escape: (value: string) => string,
): string {
  const unique = (selector: string) => {
    try { return count(selector) === 1; } catch { return false; }
  };
  const idOf = (element: SelectorNode) => (element.id ? `#${escape(element.id)}` : "");
  const tag = node.tagName.toLowerCase();
  if (idOf(node) && unique(idOf(node))) return idOf(node);
  const classes = Array.from(node.classList).filter((name) => /^[A-Za-z_-][\w-]*$/.test(name)).slice(0, 2).map((name) => `.${escape(name)}`).join("");
  if (classes && unique(`${tag}${classes}`)) return `${tag}${classes}`;
  const steps: string[] = [];
  let element: SelectorNode | null = node;
  while (element && steps.length < 12) {
    const name = element.tagName.toLowerCase();
    if (element !== node && idOf(element) && unique(idOf(element))) {
      steps.unshift(idOf(element));
      break;
    }
    if (name === "html") {
      steps.unshift("html");
      break;
    }
    const parent: SelectorNode | null = element.parentElement;
    const current: SelectorNode = element;
    const same = parent ? Array.from(parent.children).filter((child) => child.tagName === current.tagName) : [current];
    steps.unshift(same.length > 1 ? `${name}:nth-of-type(${same.indexOf(current) + 1})` : name);
    element = parent;
  }
  return steps.join(" > ");
}

/** What the picker reads from the page; every string is page-controlled and bounded in the page. */
export interface InspectedElement {
  url: string;
  title: string;
  selector: string;
  tag: string;
  html: string;
  htmlTruncated: boolean;
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
}

export const INSPECT_HTML_LIMIT = 6_000;

export const INSPECT_STYLE_PROPERTIES = [
  "display", "position", "box-sizing", "width", "height", "margin", "padding",
  "color", "background-color", "font-family", "font-size", "font-weight", "line-height",
  "border", "border-radius", "box-shadow", "opacity", "z-index", "overflow",
  "flex-direction", "justify-content", "align-items", "gap", "grid-template-columns",
] as const;

export function elementToMarkdown(element: InspectedElement): string {
  const styles = Object.entries(element.styles)
    .filter(([, value]) => value && value !== "none" && value !== "normal" && value !== "auto")
    .map(([name, value]) => `- ${name}: ${value}`)
    .join("\n");
  const size = `${Math.round(element.rect.width)} × ${Math.round(element.rect.height)}`;
  const fence = element.html.includes("```") ? "````" : "```";
  return [
    `# Page element: ${element.selector}`,
    "",
    `Page: ${element.title ? `${element.title} (${element.url})` : element.url}`,
    `Selector: \`${element.selector}\``,
    `Size: ${size} CSS px`,
    "",
    "## Computed styles",
    "",
    styles || "- (none reported)",
    "",
    `## HTML${element.htmlTruncated ? " (truncated)" : ""}`,
    "",
    `${fence}html`,
    element.html,
    fence,
    "",
  ].join("\n");
}
