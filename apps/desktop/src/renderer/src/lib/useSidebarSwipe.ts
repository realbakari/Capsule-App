import { useEffect } from "react";
import {
  dominantHorizontalDelta,
  reduceSwipe,
  swipeTargetAllows,
  SWIPE_EDGE_PX,
  SWIPE_IDLE_MS,
} from "./sidebar-swipe";

export function useSidebarSwipe(collapsed: boolean, setCollapsed: (value: boolean) => void) {
  useEffect(() => {
    let accumulated = 0;
    let idle = 0;
    let drag: { x: number; collapsed: boolean } | undefined;

    const commit = (next: boolean) => {
      accumulated = 0;
      setCollapsed(next);
    };

    const onWheel = (event: WheelEvent) => {
      const deltaX = dominantHorizontalDelta(event.deltaX, event.deltaY);
      if (!deltaX) return;
      if (!swipeTargetAllows(event, collapsed)) return;
      event.preventDefault();
      const result = reduceSwipe({ accumulated, deltaX, collapsed });
      accumulated = result.accumulated;
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        accumulated = 0;
      }, SWIPE_IDLE_MS);
      if (result.commit === "hide") commit(true);
      if (result.commit === "show") commit(false);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (!collapsed) return;
      if (event.clientX > SWIPE_EDGE_PX) return;
      drag = { x: event.clientX, collapsed };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag) return;
      if (event.clientX - drag.x >= SWIPE_EDGE_PX) {
        drag = undefined;
        commit(false);
      }
    };

    const onPointerUp = () => {
      drag = undefined;
    };

    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    return () => {
      window.clearTimeout(idle);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
    };
  }, [collapsed, setCollapsed]);
}
