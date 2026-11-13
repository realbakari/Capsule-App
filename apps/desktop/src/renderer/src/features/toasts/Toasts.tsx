import { useEffect, useRef, useState } from "react";
import { useToasts, type Toast } from "../../lib/toasts";
import { AlertTriangleIcon, CheckIcon, XIcon } from "../shell/icons";
import "./toasts.css";

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], .xterm"));
}

/**
 * The stack sits under the titlebar on the right, clear of the composer and
 * every control below it; newest last. Timers
 * pause while the pointer or focus is inside, so a toast is never pulled out
 * from under someone reaching for its button.
 */
export function Toasts() {
  const { toasts, dismiss } = useToasts();
  const [paused, setPaused] = useState(false);
  const latest = useRef(toasts);
  latest.current = toasts;

  useEffect(() => {
    const undo = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z") return;
      if (event.defaultPrevented || isTyping(event.target)) return;
      const toast = [...latest.current].reverse().find((item) => item.action?.undo);
      if (!toast?.action) return;
      event.preventDefault();
      dismiss(toast.id);
      void toast.action.run();
    };
    document.addEventListener("keydown", undo);
    return () => document.removeEventListener("keydown", undo);
  }, [dismiss]);

  return (
    <section
      className="toast-stack"
      aria-label="Notifications"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false); }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || toasts.length === 0) return;
        event.stopPropagation();
        dismiss(toasts[toasts.length - 1]!.id);
      }}
    >
      {toasts.map((toast) => <ToastRow key={toast.id} toast={toast} paused={paused} onDismiss={() => dismiss(toast.id)} />)}
    </section>
  );
}

function ToastRow({ toast, paused, onDismiss }: { toast: Toast; paused: boolean; onDismiss: () => void }) {
  const remaining = useRef(toast.timeoutMs);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (paused || toast.timeoutMs <= 0) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(1_500, remaining.current - (Date.now() - started));
    };
  }, [paused, toast.timeoutMs]);

  return (
    <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
      {toast.tone === "error" ? <AlertTriangleIcon size={14} className="toast-icon" /> : toast.tone === "success" ? <CheckIcon size={14} className="toast-icon" /> : null}
      <div className="toast-text">
        <span className="toast-title" title={toast.title}>{toast.title}</span>
        {toast.detail && <span className="toast-detail">{toast.detail}</span>}
      </div>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => { onDismiss(); void toast.action!.run(); }}
          title={toast.action.undo ? `${toast.action.label} (⌘Z)` : undefined}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="icon-btn toast-close" aria-label="Dismiss" onClick={onDismiss}>
        <XIcon size={12} />
      </button>
    </div>
  );
}
