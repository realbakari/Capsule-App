import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

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
      const top = Math.min(rect.bottom + 6, window.innerHeight - 16);
      node.style.maxHeight = `${Math.max(0, window.innerHeight - top - 8)}px`;
      node.style.top = `${top}px`;
      node.style.left = `${Math.max(8, Math.min(rect.right - node.offsetWidth, window.innerWidth - node.offsetWidth - 8))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    observer.observe(trigger);
    const focusTarget = node.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled), [tabindex='0']");
    (focusTarget ?? node).focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!node.contains(event.target as Node) && !trigger.contains(event.target as Node)) close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
      trigger.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    };
    const blur = (event: FocusEvent) => {
      if (!node.contains(event.target as Node) && !trigger.contains(event.target as Node)) close.current();
    };
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", blur);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
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
