import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** Own one pointer until release, cancellation, focus loss, or unmount. */
export function beginPanelResize(
  target: HTMLElement,
  event: Pick<PointerEvent, "pointerId" | "clientX">,
  onDelta: (delta: number) => void,
  onEnd: () => void,
): () => void {
  const { pointerId, clientX: origin } = event;
  const host = target.ownerDocument.defaultView!;
  let active = true;

  const cleanup = () => {
    if (!active) return;
    active = false;
    host.removeEventListener("pointermove", move);
    host.removeEventListener("pointerup", up);
    host.removeEventListener("pointercancel", cancel);
    host.removeEventListener("blur", finish);
    target.removeEventListener("lostpointercapture", cancel);
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  };
  const finish = () => { cleanup(); onEnd(); };
  const move = (next: PointerEvent) => {
    if (next.pointerId === pointerId) onDelta(next.clientX - origin);
  };
  const up = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    // A release may arrive after the last move, or with no move at all.
    try { onDelta(next.clientX - origin); } finally { finish(); }
  };
  const cancel = (next: PointerEvent) => {
    if (next.pointerId === pointerId) finish();
  };

  host.addEventListener("pointermove", move);
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", cancel);
  host.addEventListener("blur", finish);
  target.addEventListener("lostpointercapture", cancel);
  try { target.setPointerCapture(pointerId); } catch {
    // Synthetic events and a pointer already released cannot be captured.
    // Window listeners still provide a fully cancellable interaction.
  }
  return cleanup;
}

export function usePanelResize(enabled = true) {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const [resizing, setResizing] = useState(false);
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => {
    if (!enabled) { cleanup.current?.(); setResizing(false); }
  }, [enabled]);

  function startResize(event: ReactPointerEvent<HTMLElement>, onDelta: (delta: number) => void) {
    if (!enabled || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    cleanup.current?.();
    setResizing(true);
    cleanup.current = beginPanelResize(event.currentTarget, event, onDelta, () => setResizing(false));
  }
  return { resizing, startResize };
}
