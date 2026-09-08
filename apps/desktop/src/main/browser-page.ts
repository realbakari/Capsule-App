/** Scripts run in a private world: the page cannot replace our element map. */
export const BROWSER_WORLD = 999;

export function snapshotScript(snapshotId: string): string {
  return `(() => {
    const nodes = new Map();
    const elements = [];
    let visited = 0, text = '', truncated = false;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    const visible = (el) => {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
    };
    const labelFor = (el) => {
      const explicit = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder');
      if (explicit) return explicit.slice(0,120);
      const label = el.labels?.[0] || el;
      const texts = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      let result = '', scanned = 0;
      while (texts.nextNode() && ++scanned <= 30 && result.length < 120) result += texts.currentNode.textContent.slice(0,120);
      return result.trim().replace(/\\s+/g,' ').slice(0,120);
    };
    const signature = (el) => JSON.stringify([el.tagName, el.getAttribute('type'), el.getAttribute('href'), labelFor(el)]);
    while (walker.nextNode()) {
      if (++visited > 5000) { truncated = true; break; }
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (parent && !parent.closest('script,style,noscript,textarea,[type="password"]') && visible(parent)) {
          text += (node.textContent || '').slice(0, 2000) + '\\n';
          if (text.length > 20000) { text = text.slice(0, 20000); truncated = true; }
        }
        continue;
      }
      const el = node;
      if (!el.matches('a[href],button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[contenteditable="true"]') || !visible(el)) continue;
      if (elements.length >= 200) { truncated = true; continue; }
      const ref = elements.length + 1;
      nodes.set(ref, { element: el, signature: signature(el) });
      const label = labelFor(el);
      elements.push({ ref, tag: el.tagName.toLowerCase(), type: el.getAttribute('type'),
        label: label.trim().replace(/\\s+/g, ' ').slice(0,120),
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        href: el.tagName === 'A' ? (el.getAttribute('href') || '').slice(0,1024) : undefined,
        options: el.tagName === 'SELECT' ? [...el.options].slice(0,30).map(option => ({ value: option.value.slice(0,120), label: option.label.slice(0,120), disabled: option.disabled })) : undefined });
    }
    globalThis.__capsuleSnapshot = { id: ${JSON.stringify(snapshotId)}, url: location.href, nodes, signature };
    return { snapshotId: ${JSON.stringify(snapshotId)}, url: location.href.slice(0,2048), title: document.title.slice(0,512), text, elements, truncated };
  })()`;
}

export interface BrowserAction {
  action: "click" | "type" | "select" | "focus";
  snapshotId: string;
  ref: number;
  text?: string;
}

export function actionScript(input: BrowserAction): string {
  // The deadline also prevents a queued script acting much later on a busy page.
  return `(() => {
    if (Date.now() > ${Date.now() + 10_000}) throw new Error('Browser action expired. Take a new snapshot.');
    const input = ${JSON.stringify(input)};
    const state = globalThis.__capsuleSnapshot;
    const entry = state?.id === input.snapshotId && state.url === location.href ? state.nodes.get(input.ref) : undefined;
    const el = entry?.element;
    if (!el || !el.isConnected) throw new Error('Stale element reference. Take a new browser_snapshot.');
    if (entry.signature !== state.signature(el)) throw new Error('The element changed since the snapshot. Take a new browser_snapshot.');
    if (el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true') throw new Error('This element is disabled or read-only.');
    if (el.matches('input[type="password"],input[type="file"]')) throw new Error('Password entry and file uploads require the person using Capsule.');
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!rect.width || !rect.height || style.visibility === 'hidden' || !(el === hit || el.contains(hit))) throw new Error('The element is hidden or covered. Take a new snapshot.');
    if (input.action === 'click') {
      if (el.closest('a[download]')) throw new Error('Downloads require the person using Capsule.');
      el.click();
    } else if (input.action === 'focus') {
      el.focus();
      if (document.activeElement !== el) throw new Error('This element could not receive keyboard focus.');
    } else if (input.action === 'select') {
      if (!(el instanceof HTMLSelectElement)) throw new Error('Choose a select element from the snapshot.');
      if (![...el.options].some(option => option.value === input.text && !option.disabled)) throw new Error('No enabled option has that value.');
      el.value = input.text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLInputElement && ['text','search','email','url','tel','number'].includes(el.type))) throw new Error('Choose a text input or textarea. Rich text editing is not supported.');
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, input.text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`;
}
