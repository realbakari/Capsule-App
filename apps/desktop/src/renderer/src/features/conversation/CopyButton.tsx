import { useEffect, useRef, useState } from "react";
import { CopyIcon } from "../shell/icons";

/** A clipboard write is acknowledged only after the system accepts it. */
export function CopyButton({ text, label = "Copy message", className = "icon-btn" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const generation = useRef(0);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    generation.current++;
    busy.current = false;
    setState("idle");
    return () => { generation.current++; clearTimeout(timer.current); };
  }, [text]);

  async function copy() {
    if (busy.current) return;
    busy.current = true;
    const current = generation.current;
    clearTimeout(timer.current);
    setState("copying");
    try {
      await navigator.clipboard.writeText(text);
      if (current !== generation.current) return;
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 1800);
    } catch {
      if (current === generation.current) setState("failed");
    } finally { if (current === generation.current) busy.current = false; }
  }

  const feedback = state === "copied" ? "Copied" : state === "failed" ? "Copy failed · retry" : state === "copying" ? "Copying…" : undefined;
  return <span className="copy-action" data-feedback={Boolean(feedback)}>
    <button type="button" className={className} title={feedback ?? label} aria-label={state === "failed" ? `Retry ${label.toLowerCase()}` : label}
      disabled={state === "copying"} onClick={() => void copy()}><CopyIcon size={13} /></button>
    <span className="copy-action-feedback" role="status">{feedback}</span>
  </span>;
}
