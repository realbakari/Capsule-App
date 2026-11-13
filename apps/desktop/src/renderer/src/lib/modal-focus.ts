import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A modal owns the keyboard while it is open: focus moves into it, Tab stays
 * inside it, Escape closes it, and focus goes back to whatever opened it.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, initial?: string): void {
  /* Held in a ref so an inline onClose does not re-run the effect and bounce focus. */
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const node = ref.current;
    const first = (initial && node?.querySelector<HTMLElement>(initial)) || node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab" || !ref.current) return;
      const controls = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!controls.length) { event.preventDefault(); return; }
      const inside = ref.current.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === controls[0])) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && (!inside || document.activeElement === controls.at(-1))) { event.preventDefault(); controls[0]?.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [open, ref, initial]);
}
