import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/** Viewport coordinates for a body portal; never clipped by composer glass. */
export function useAnchoredPopover(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });
  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const place = () => {
      if (!anchor.current || !panel.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const above = Math.max(0, rect.top - 20);
      const below = Math.max(0, innerHeight - rect.bottom - 20);
      const up = above >= Math.min(300, below);
      const width = Math.min(384, innerWidth - 24);
      const maxHeight = Math.min(520, up ? above : below);
      const height = Math.min(panel.current.getBoundingClientRect().height, maxHeight);
      const next: CSSProperties = { position: "fixed", visibility: "visible", width, maxHeight,
        left: Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)),
        top: Math.max(12, Math.min(up ? rect.top - height - 8 : rect.bottom + 8, innerHeight - height - 12)),
        bottom: "auto", right: "auto" };
      setPosition((current) => Object.keys(next).every((key) => current[key as keyof CSSProperties] === next[key as keyof CSSProperties]) ? current : next);
    };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) place(); };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel.current); observer.observe(anchor.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", scroll, true); };
  }, [open, anchor, panel]);
  return position;
}
