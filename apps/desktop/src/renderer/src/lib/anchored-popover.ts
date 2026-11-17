import { originToward } from "./floating-placement";
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

const TOP_CLEARANCE = 60;

/** Viewport coordinates for a body portal; never clipped by composer glass. */
export function useAnchoredPopover(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, align: "start" | "end" = "end", preferredWidth = 384): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });
  /* The side is chosen once per opening; content that changes height must not flip it under the pointer. */
  const side = useRef<"up" | "down">(undefined);
  useLayoutEffect(() => {
    if (!open) side.current = undefined;
    if (!open || !anchor.current || !panel.current) return;
    const place = () => {
      if (!anchor.current || !panel.current) return;
      const rect = anchor.current.getBoundingClientRect();
      /* The 52px titlebar is not free space: a popover opening upward stops below it. */
      const above = Math.max(0, rect.top - TOP_CLEARANCE - 8);
      const below = Math.max(0, innerHeight - rect.bottom - 20);
      side.current ??= above >= Math.min(300, below) ? "up" : "down";
      const up = side.current === "up";
      const width = Math.min(preferredWidth, innerWidth - 24);
      const maxHeight = Math.min(520, up ? above : below);
      const height = Math.min(panel.current.getBoundingClientRect().height, maxHeight);
      const left = Math.max(12, Math.min(align === "start" ? rect.left : rect.right - width, innerWidth - width - 12));
      const top = Math.max(TOP_CLEARANCE, Math.min(up ? rect.top - height - 8 : rect.bottom + 8, innerHeight - height - 12));
      const next: CSSProperties = { position: "fixed", visibility: "visible", width, maxHeight, left, top,
        bottom: "auto", right: "auto", transformOrigin: originToward(rect, { left, top, width, height }) };
      setPosition((current) => Object.keys(next).every((key) => current[key as keyof CSSProperties] === next[key as keyof CSSProperties]) ? current : next);
    };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) place(); };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel.current); observer.observe(anchor.current);
    const resize = () => { side.current = undefined; place(); };
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", scroll, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); window.removeEventListener("scroll", scroll, true); };
  }, [open, anchor, panel, align, preferredWidth]);
  return position;
}
