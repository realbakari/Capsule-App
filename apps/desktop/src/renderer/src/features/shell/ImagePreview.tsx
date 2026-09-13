import { useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Read-only inspection: the displayed source is never rewritten or resampled. */
export function ImagePreview({ src, name }: { src: string; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | undefined>();
  const [width, setWidth] = useState(0);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  return <>
    <button ref={trigger} type="button" className="file-preview-frame image-preview-open" aria-label={`Inspect image ${name}`}
      onClick={() => { setScale(undefined); dialog.current?.showModal(); }}>
      <img src={src} alt={name} className="file-preview-image" />
    </button>
    {createPortal(<dialog ref={dialog} className="image-inspector" aria-label={`Image preview: ${name}`} onClose={() => { drag.current = undefined; trigger.current?.focus(); }} onClick={(event) => {
      if (event.target === dialog.current) dialog.current?.close();
    }}>
      <header className="image-inspector-toolbar">
        <span className="truncate" title={name}>{name}</span>
        <button type="button" aria-pressed={scale === undefined} onClick={() => setScale(undefined)}>Fit</button>
        <button type="button" aria-pressed={scale === 1} onClick={() => setScale(1)}>100%</button>
        <button type="button" aria-label="Zoom out" disabled={scale !== undefined && scale <= 0.25} onClick={() => setScale(Math.max(0.25, (scale ?? 1) / 2))}>−</button>
        <button type="button" aria-label="Zoom in" disabled={scale !== undefined && scale >= 4} onClick={() => setScale(Math.min(4, (scale ?? 1) * 2))}>+</button>
        <button type="button" onClick={() => dialog.current?.close()}>Close</button>
      </header>
      <div ref={viewport} className="image-inspector-viewport" data-fit={scale === undefined} tabIndex={0} aria-label="Image; use arrow keys or scroll to pan"
        onKeyDown={(event) => {
          const moves: Record<string, [number, number]> = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] };
          const move = moves[event.key];
          if (move) { event.preventDefault(); viewport.current?.scrollBy(...move); }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || scale === undefined) return;
          drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          event.currentTarget.scrollTo(drag.current.left - event.clientX + drag.current.x, drag.current.top - event.clientY + drag.current.y);
        }}
        onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}>
        <img src={src} alt={name} draggable={false} onLoad={(event) => setWidth(event.currentTarget.naturalWidth)}
          style={scale === undefined ? undefined : { width: width * scale, maxWidth: "none", maxHeight: "none" }} />
      </div>
    </dialog>, document.body)}
  </>;
}
