import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { floatingPlacement } from "../../lib/floating-placement";

/** Header controls are clipped and inside a drag region. Their popovers aren't. */
export function HeaderPopover({ anchor, label, className = "", onClose, children }: {
  anchor: RefObject<HTMLDivElement | null>;
  label: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const node = panel.current;
    const trigger = anchor.current;
    if (!node || !trigger) return;
    const place = () => {
      const rect = trigger.getBoundingClientRect();
      const position = floatingPlacement(rect, { width: node.offsetWidth, height: node.scrollHeight }, { width: window.innerWidth, height: window.innerHeight }, { align: "right" });
      node.style.maxWidth = `${position.maxWidth}px`;
      node.style.maxHeight = `${position.maxHeight}px`;
      node.style.top = `${position.top}px`;
      node.style.left = `${position.left}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    observer.observe(trigger);
    const focusTarget = node.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled), [tabindex='0']");
    (focusTarget ?? node).focus({ preventScroll: true });
    /*
     * A menu opened from a row inside this popover is portalled to the body,
     * so it is outside this node. It still belongs here: clicking or focusing
     * in it must not close the popover it came from. Popovers opened later
     * stack after this one, and dialogs (an action editor) count too.
     */
    const ours = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      if (node.contains(target) || trigger.contains(target)) return true;
      const layer = target instanceof Element ? target.closest(".header-popover, [role='dialog'], dialog, .palette-backdrop") : target.parentElement?.closest(".header-popover, [role='dialog'], dialog, .palette-backdrop");
      return Boolean(layer && layer !== node && (layer.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING));
    };
    const outside = (event: PointerEvent) => {
      if (!ours(event.target)) close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape closes the topmost layer only; a menu opened from this one goes first.
      const layers = document.querySelectorAll(".header-popover");
      if (layers[layers.length - 1] !== node) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
      trigger.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    };
    const blur = (event: FocusEvent) => {
      if (!ours(event.target)) close.current();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", blur);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", blur);
    };
  }, [anchor]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={panel} role="dialog" aria-label={label} tabIndex={-1} className={`topbar-dropdown-menu header-popover ${className}`}>
      {children}
    </div>,
    document.body,
  );
}
