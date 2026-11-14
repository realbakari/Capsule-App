import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../lib/modal-focus";
import { XIcon, ZoomActualIcon, ZoomFitIcon } from "../shell/icons";
import "./markdown-media.css";

/** Fit shows the whole image; 100% shows real pixels and scrolls. Escape closes and focus returns to the image. */
export function ImageZoomDialog({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"fit" | "actual">("fit");
  useModalFocus(card, true, onClose, ".md-zoom-close");
  const label = alt || "Image";
  return createPortal(<div className="md-zoom-overlay" onClick={onClose}>
    <div className="md-zoom" ref={card} role="dialog" aria-modal="true" aria-label={label} onClick={(event) => event.stopPropagation()}>
      <div className="md-zoom-bar">
        <span className="md-zoom-title" title={label}>{label}</span>
        <div className="md-zoom-modes" role="group" aria-label="Zoom">
          <button type="button" className="md-media-button" aria-pressed={mode === "fit"} onClick={() => setMode("fit")}><ZoomFitIcon size={13} />Fit</button>
          <button type="button" className="md-media-button" aria-pressed={mode === "actual"} onClick={() => setMode("actual")}><ZoomActualIcon size={13} />100%</button>
        </div>
        <button type="button" className="icon-btn md-zoom-close" aria-label="Close image" title="Close (Esc)" onClick={onClose}><XIcon size={15} /></button>
      </div>
      <div className={`md-zoom-stage md-zoom-stage--${mode}`} tabIndex={0} aria-label={`${label}, ${mode === "fit" ? "fit to window" : "actual size"}`}>
        <img src={src} alt={alt} draggable={false} />
      </div>
    </div>
  </div>, document.body);
}
