import { useEffect, useRef, useState } from "react";

/**
 * One tooltip for the whole app. Any element with a `title` gets it, on hover
 * after a short delay or at once on keyboard focus, styled like the rest of
 * the interface instead of the system's slow plain-text tip. While it shows,
 * the element's `title` is held aside so the native tip does not appear too,
 * and it is put back as soon as the tooltip goes.
 *
 * A trailing shortcut in parentheses, such as "Toggle terminal (⌘J)", is drawn
 * as a key.
 */

const SHOW_DELAY_MS = 450;
/* Moving from one control to the next while a tip is showing switches at once. */
const WARM_MS = 300;
const GAP = 6;
const SHORTCUT = /\s*\(([⌘⌥⌃⇧][^()]*)\)\s*$/;

interface Tip { text: string; shortcut?: string; x: number; y: number; placement: "below" | "above" }

function split(title: string): { text: string; shortcut?: string } {
  const match = SHORTCUT.exec(title);
  return match ? { text: title.slice(0, match.index), shortcut: match[1] } : { text: title };
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip>();
  const tipRef = useRef<HTMLDivElement>(null);
  const owner = useRef<HTMLElement | undefined>(undefined);
  const timer = useRef(0);
  const lastHidden = useRef(0);

  useEffect(() => {
    const restore = () => {
      const element = owner.current;
      if (element?.dataset.tooltipTitle !== undefined) {
        element.setAttribute("title", element.dataset.tooltipTitle);
        delete element.dataset.tooltipTitle;
      }
      owner.current = undefined;
    };
    const hide = () => {
      window.clearTimeout(timer.current);
      if (owner.current) lastHidden.current = Date.now();
      restore();
      setTip(undefined);
    };
    const show = (element: HTMLElement, immediate: boolean) => {
      const title = element.getAttribute("title");
      if (!title?.trim()) return;
      window.clearTimeout(timer.current);
      const open = () => {
        if (!element.isConnected) return;
        restore();
        owner.current = element;
        element.dataset.tooltipTitle = title;
        element.removeAttribute("title");
        const rect = element.getBoundingClientRect();
        const below = rect.bottom + GAP + 32 < window.innerHeight;
        setTip({ ...split(title), x: rect.left + rect.width / 2, y: below ? rect.bottom + GAP : rect.top - GAP, placement: below ? "below" : "above" });
      };
      if (immediate || Date.now() - lastHidden.current < WARM_MS) open();
      else timer.current = window.setTimeout(open, SHOW_DELAY_MS);
    };
    const target = (event: Event) => (event.target instanceof Element ? event.target.closest<HTMLElement>("[title]") : null);

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const element = target(event);
      if (element && element !== owner.current) show(element, false);
    };
    const onOut = (event: PointerEvent) => {
      const from = owner.current ?? target(event);
      const to = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (from && to && from.contains(to)) return;
      hide();
    };
    const onFocus = (event: FocusEvent) => {
      const element = target(event);
      if (element && element.matches(":focus-visible")) show(element, true);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  /* Keep the tip inside the window once its width is known. */
  useEffect(() => {
    const node = tipRef.current;
    if (!node || !tip) return;
    const width = node.offsetWidth;
    const left = Math.min(Math.max(8, tip.x - width / 2), window.innerWidth - width - 8);
    node.style.left = `${left}px`;
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={tipRef}
      role="tooltip"
      className="app-tooltip"
      data-placement={tip.placement}
      style={{ left: tip.x, top: tip.y }}
    >
      <span>{tip.text}</span>
      {tip.shortcut ? <kbd>{tip.shortcut}</kbd> : null}
    </div>
  );
}
