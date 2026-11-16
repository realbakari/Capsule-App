import { useEffect, useRef, useState } from "react";
import { BackgroundBrowser } from "./BackgroundBrowser";
import { ShieldIcon } from "./icons";

/** Permission details are discoverable without taking height away from the page. */
export function BrowserControls({ allowed, disabled, detail, active, backgroundAvailable, url, onToggle, onBackgroundControl }: {
  allowed: boolean;
  disabled: boolean;
  detail: string;
  active: boolean;
  backgroundAvailable: boolean;
  url: string;
  onToggle: () => void;
  onBackgroundControl: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <details ref={ref} className="browser-controls" data-allowed={allowed} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="browser-controls-trigger" aria-label={`Agent control ${allowed ? "on" : "off"}`} title={allowed ? "Agent control on: this thread's agent can use this page" : "Agent control off: allow this thread's agent to use this page"}>
      <ShieldIcon size={13} /><span>Agent control {allowed ? "on" : "off"}</span>
    </summary>
    <div className="browser-controls-popover">
      <div className="browser-controls-heading"><strong>Agent control</strong><span>{allowed ? "On for this thread" : "Off"}</span></div>
      <p>Let this thread’s agent use the page shown here, including signed-in content. Switching threads or closing this panel turns it off.</p>
      <button type="button" className="chip" aria-pressed={allowed} disabled={disabled} onClick={onToggle}>{allowed ? "Turn off agent control" : "Allow agent control"}</button>
      {disabled && <p role="status">{detail}</p>}
      <details className="browser-controls-capability"><summary>Availability and permissions</summary>
        {!disabled && <p>{detail}</p>}
        <p>Camera, microphone, location and clipboard permissions stay blocked.</p>
      </details>
      <BackgroundBrowser desktop url={url} available={backgroundAvailable} active={active && open} onControlChange={onBackgroundControl} />
    </div>
  </details>;
}
