import { useEffect, useRef, useState } from "react";
import type { SimulatorFrame } from "@capsule/shared";
import { CopyIcon, PlusIcon, TrashIcon, UndoIcon, XIcon } from "./icons";

/** A stroke in screen fractions (0..1), so it follows the drawing at any zoom. */
interface Stroke { points: Array<{ x: number; y: number }> }

const INK = "#ff453a";
/** Stroke width as a fraction of the screen's shorter side. */
const INK_WIDTH = 0.012;

function draw(context: CanvasRenderingContext2D, strokes: Stroke[], width: number, height: number): void {
  context.strokeStyle = INK;
  context.lineWidth = Math.max(2, INK_WIDTH * Math.min(width, height));
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    const [first, ...rest] = stroke.points;
    if (!first) continue;
    context.beginPath();
    context.moveTo(first.x * width, first.y * height);
    if (rest.length === 0) context.lineTo(first.x * width + 0.01, first.y * height);
    for (const point of rest) context.lineTo(point.x * width, point.y * height);
    context.stroke();
  }
}

/** The frozen frame with the marks on it, at the frame's own pixel size. */
export async function renderAnnotated(frame: SimulatorFrame, strokes: Stroke[]): Promise<Uint8Array> {
  const image = new Image();
  image.src = frame.dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The screenshot could not be drawn.");
  context.drawImage(image, 0, 0);
  draw(context, strokes, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("The screenshot could not be encoded."))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Mark up the screen before sending it: the live stream pauses on one frame,
 * the pointer draws instead of tapping, and the result goes into the message
 * or onto the clipboard.
 */
export function SimulatorAnnotator({ frame, onAdd, onCopy, onCancel }: {
  frame: SimulatorFrame;
  onAdd: (png: Uint8Array) => Promise<void>;
  onCopy: (png: Uint8Array) => Promise<void>;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [busy, setBusy] = useState(false);
  const drawing = useRef<Stroke | undefined>(undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      draw(context, drawing.current ? [...strokes, drawing.current] : strokes, canvas.width, canvas.height);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [strokes]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); setStrokes((current) => current.slice(0, -1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const at = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
  };

  const finish = async (send: (png: Uint8Array) => Promise<void>) => {
    setBusy(true);
    try { await send(await renderAnnotated(frame, strokes)); } finally { setBusy(false); }
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="simulator-annotate-canvas"
        aria-label="Draw on the screenshot"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* No active pointer. */ }
          drawing.current = { points: [at(event)] };
          setStrokes((current) => [...current]);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          drawing.current.points.push(at(event));
          setStrokes((current) => [...current]);
        }}
        onPointerUp={() => {
          const stroke = drawing.current;
          drawing.current = undefined;
          if (stroke) setStrokes((current) => [...current, stroke]);
        }}
        onPointerCancel={() => { drawing.current = undefined; setStrokes((current) => [...current]); }}
      />
      <div className="simulator-toolbar simulator-annotate-bar" role="toolbar" aria-label="Annotate the screenshot">
        <button type="button" className="preview-chrome-btn" title="Undo (⌘Z)" aria-label="Undo" disabled={strokes.length === 0 || busy} onClick={() => setStrokes((current) => current.slice(0, -1))}><UndoIcon size={15} /></button>
        <button type="button" className="preview-chrome-btn" title="Clear the marks" aria-label="Clear the marks" disabled={strokes.length === 0 || busy} onClick={() => setStrokes([])}><TrashIcon size={15} /></button>
        <span className="simulator-toolbar-sep" />
        <button type="button" className="preview-chrome-btn" title="Copy the marked-up screenshot" aria-label="Copy the marked-up screenshot" disabled={busy} onClick={() => void finish(onCopy)}><CopyIcon size={15} /></button>
        <button type="button" className="simulator-annotate-add" disabled={busy} onClick={() => void finish(onAdd)}><PlusIcon size={14} />Add to message</button>
        <span className="simulator-toolbar-sep" />
        <button type="button" className="preview-chrome-btn" title="Stop annotating (Esc)" aria-label="Stop annotating" disabled={busy} onClick={onCancel}><XIcon size={15} /></button>
      </div>
    </>
  );
}
