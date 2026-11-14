import { cssSelectorFor, INSPECT_HTML_LIMIT, INSPECT_STYLE_PROPERTIES, type InspectedElement } from "@capsule/shared";

export const CANCEL_PICKER_SCRIPT = "if (window.__capsulePickerCleanup) window.__capsulePickerCleanup();";

/**
 * Runs in the Browser page. Hover outlines an element, a click picks it and
 * resolves with what `InspectedElement` describes, Esc resolves null.
 */
export function elementPickerScript(): string {
  return String.raw`
(() => {
  const cssSelectorFor = ${cssSelectorFor.toString()};
  const STYLE_PROPERTIES = ${JSON.stringify(INSPECT_STYLE_PROPERTIES)};
  const HTML_LIMIT = ${INSPECT_HTML_LIMIT};
  if (window.__capsulePickerCleanup) window.__capsulePickerCleanup();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;background:rgba(59,130,246,.16);border-radius:2px;display:none;box-sizing:border-box';
    const badge = document.createElement('div');
    badge.style.cssText = 'position:absolute;bottom:100%;left:-2px;margin-bottom:4px;padding:2px 6px;background:#18181b;color:#f4f4f5;border:1px solid rgba(255,255,255,.15);font:500 11px ui-monospace,monospace;border-radius:4px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.4)';
    overlay.appendChild(badge);
    document.documentElement.appendChild(overlay);
    let target = null;

    const describe = (element) => {
      let label = element.tagName.toLowerCase();
      if (element.id) label += '#' + element.id;
      else if (typeof element.className === 'string' && element.className.trim()) label += '.' + element.className.trim().split(/\s+/).slice(0, 2).join('.');
      return label.slice(0, 80);
    };
    const onMove = (event) => {
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (!hit || hit === overlay || overlay.contains(hit)) return;
      target = hit;
      const rect = hit.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.top = rect.top + 'px';
      overlay.style.left = rect.left + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
      badge.style.top = rect.top < 24 ? '100%' : '';
      badge.style.bottom = rect.top < 24 ? '' : '100%';
      badge.textContent = describe(hit) + '  ' + Math.round(rect.width) + ' × ' + Math.round(rect.height);
    };
    const finish = (value) => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      delete window.__capsulePickerCleanup;
      resolve(value);
    };
    const onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!target) return finish(null);
      const element = target;
      const style = getComputedStyle(element);
      const styles = {};
      for (const name of STYLE_PROPERTIES) styles[name] = style.getPropertyValue(name).slice(0, 200);
      const html = element.outerHTML || '';
      const rect = element.getBoundingClientRect();
      finish({
        url: location.href.slice(0, 2048),
        title: document.title.slice(0, 300),
        selector: cssSelectorFor(element, (selector) => document.querySelectorAll(selector).length, CSS.escape).slice(0, 1000),
        tag: element.tagName.toLowerCase(),
        html: html.slice(0, HTML_LIMIT),
        htmlTruncated: html.length > HTML_LIMIT,
        styles,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      });
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finish(null);
    };
    window.__capsulePickerCleanup = () => finish(null);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  });
})()
`;
}

/** The page's answer is untrusted: keep only well-formed fields. */
export function readInspectedElement(value: unknown): InspectedElement | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<InspectedElement>;
  const rect = raw.rect;
  if (typeof raw.selector !== "string" || !raw.selector || typeof raw.html !== "string" || !rect
    || ![rect.x, rect.y, rect.width, rect.height].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  const styles: Record<string, string> = {};
  for (const name of INSPECT_STYLE_PROPERTIES) {
    const style = raw.styles?.[name];
    if (typeof style === "string") styles[name] = style.slice(0, 200);
  }
  return {
    url: typeof raw.url === "string" ? raw.url.slice(0, 2048) : "",
    title: typeof raw.title === "string" ? raw.title.slice(0, 300) : "",
    selector: raw.selector.slice(0, 1000),
    tag: typeof raw.tag === "string" ? raw.tag.slice(0, 40) : "element",
    html: raw.html.slice(0, INSPECT_HTML_LIMIT),
    htmlTruncated: raw.htmlTruncated === true,
    styles,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}
