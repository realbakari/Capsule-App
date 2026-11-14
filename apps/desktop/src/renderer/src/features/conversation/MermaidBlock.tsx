import { memo, useEffect, useReducer, useState } from "react";
import { useSurfaceTheme } from "../../lib/surface-theme";
import { svgImageUrl } from "../../lib/markdown-media";
import { MaximizeIcon } from "../shell/icons";
import { CodeBlock } from "./CodeBlock";
import { CopyButton } from "./CopyButton";
import { ImageZoomDialog } from "./ImageZoomDialog";
import "./markdown-media.css";

type Drawing = { svg: string } | { reason: string };

/* Keyed by theme and source, so a re-render, a remount or a scroll back never redraws. */
const drawings = new Map<string, Drawing>();

function remember(key: string, drawing: Drawing) {
  if (drawings.size > 80) drawings.delete(drawings.keys().next().value!);
  drawings.set(key, drawing);
}

function failure(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).split("\n").map((line) => line.trim()).find(Boolean) ?? "Unknown error";
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/**
 * A streaming block shows its source; the diagram is drawn once the fence
 * closes, again only when the theme or source changes.
 */
export const MermaidBlock = memo(function MermaidBlock({ code, closed }: { code: string; closed: boolean }) {
  const theme = useSurfaceTheme();
  const key = `${theme}\n${code}`;
  const [, drawn] = useReducer((count: number) => count + 1, 0);
  const [showSource, setShowSource] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const drawing = closed ? drawings.get(key) : undefined;
  useEffect(() => {
    if (!closed || drawings.has(key) || !code.trim()) return;
    let live = true;
    import("./mermaid-runtime")
      .then((runtime) => runtime.renderMermaid(code, theme))
      .then((svg): Drawing => ({ svg }), (error: unknown): Drawing => ({ reason: failure(error) }))
      .then((result) => { remember(key, result); if (live) drawn(); });
    return () => { live = false; };
  }, [closed, code, key, theme]);

  if (!drawing) return <CodeBlock code={code} language="mermaid" />;
  if ("reason" in drawing) return <div className="md-diagram-failed">
    <p className="md-media-note" role="note">This diagram could not be drawn: {drawing.reason}</p>
    <CodeBlock code={code} language="mermaid" />
  </div>;
  return <figure className="md-diagram" aria-label="Diagram">
    <div className="msg-code-bar">
      <span className="msg-code-lang">mermaid</span>
      <span className="md-diagram-tools">
        <button type="button" className="md-media-button" aria-pressed={showSource} onClick={() => setShowSource((value) => !value)}>
          {showSource ? "Diagram" : "Source"}
        </button>
        {!showSource && <button type="button" className="icon-btn" aria-label="Expand diagram" title="Expand diagram" onClick={() => setZoomed(true)}><MaximizeIcon size={13} /></button>}
        <CopyButton text={code} label="Copy diagram source" />
      </span>
    </div>
    {showSource
      ? <pre className="msg-code" tabIndex={0} aria-label="mermaid source">{code}</pre>
      : <div className="md-diagram-canvas" role="img" aria-label="Rendered diagram" dangerouslySetInnerHTML={{ __html: drawing.svg }} onDoubleClick={() => setZoomed(true)} />}
    {zoomed && <ImageZoomDialog src={svgImageUrl(drawing.svg)} alt="Diagram" onClose={() => setZoomed(false)} />}
  </figure>;
});
