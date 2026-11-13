import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HTML_PREVIEW_SANDBOX, htmlPreviewDocument } from "../../lib/markdown-media";
import { useModalFocus } from "../../lib/modal-focus";
import { RefreshIcon, XIcon } from "../shell/icons";
import "./markdown-media.css";

function HtmlPreviewDialog({ html, onClose }: { html: string; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const [scripts, setScripts] = useState(false);
  const [generation, setGeneration] = useState(0);
  const document = useMemo(() => htmlPreviewDocument(html, scripts), [html, scripts]);
  useModalFocus(card, true, onClose, ".md-zoom-close");
  return createPortal(<div className="md-zoom-overlay" onClick={onClose}>
    <div className="md-zoom md-html-preview" ref={card} role="dialog" aria-modal="true" aria-label="HTML preview" onClick={(event) => event.stopPropagation()}>
      <div className="md-zoom-bar">
        <span className="md-zoom-title">HTML preview</span>
        <label className="md-html-scripts">
          <input type="checkbox" checked={scripts} onChange={(event) => setScripts(event.target.checked)} />
          Run scripts
        </label>
        <button type="button" className="icon-btn" aria-label="Reload preview" title="Reload preview" onClick={() => setGeneration((value) => value + 1)}><RefreshIcon size={14} /></button>
        <button type="button" className="icon-btn md-zoom-close" aria-label="Close preview" title="Close (Esc)" onClick={onClose}><XIcon size={15} /></button>
      </div>
      <iframe key={`${scripts}-${generation}`} className="md-html-frame" title="HTML preview" srcDoc={document}
        sandbox={scripts ? HTML_PREVIEW_SANDBOX.on : HTML_PREVIEW_SANDBOX.off} referrerPolicy="no-referrer" />
      <p className="md-html-note">
        {scripts
          ? "Scripts are running in an isolated frame. It has no network and cannot reach Capsule or your files."
          : "Scripts are off. The preview has no network, so web images and fonts do not load."}
      </p>
    </div>
  </div>, window.document.body);
}

/** An HTML block opens in a sandboxed, offline frame. */
export function HtmlPreviewButton({ html }: { html: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="md-media-button" title="Preview this HTML in an isolated frame" onClick={() => setOpen(true)}>Preview</button>
    {open && <HtmlPreviewDialog html={html} onClose={() => setOpen(false)} />}
  </>;
}
