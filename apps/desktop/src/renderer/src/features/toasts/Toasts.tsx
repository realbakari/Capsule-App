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
/** How long a dismissed toast stays to fade out; matches --motion-fast. */
const EXIT_MS = 140;

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  const [paused, setPaused] = useState(false);
  const latest = useRef(toasts);
  latest.current = toasts;
  /*
   * A toast leaves the store from its timer, its buttons, Escape or ⌘Z. Any of
   * them: hold what went for one short fade instead of cutting it.
   */
  const [leaving, setLeaving] = useState<Array<{ toast: Toast; slot: number }>>([]);
  const shown = useRef(toasts);
  const exits = useRef(new Set<number>());
  useEffect(() => {
    /* A toast replaced under the same key is an update, not a departure. */
    // Remember each departing toast's slot, so it fades where it was instead of jumping to the top.
    const gone = shown.current.flatMap((old, slot) => toasts.some((toast) => toast.id === old.id || toast.key === old.key) ? [] : [{ toast: old, slot }]);
    shown.current = toasts;
    if (gone.length === 0) return;
    setLeaving((current) => [...current, ...gone]);
    const timer = window.setTimeout(() => {
      exits.current.delete(timer);
      setLeaving((current) => current.filter((entry) => !gone.includes(entry)));
    }, EXIT_MS);
    exits.current.add(timer);
  }, [toasts]);
  useEffect(() => () => { for (const timer of exits.current) clearTimeout(timer); }, []);

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
      {withLeaving(toasts, leaving).map(({ toast, leaving: out }) => out
        ? <ToastRow key={`leaving-${toast.id}`} toast={toast} leaving paused onDismiss={() => undefined} />
        : <ToastRow key={toast.id} toast={toast} paused={paused} onDismiss={() => dismiss(toast.id)} />)}
    </section>
  );
}

/** The live stack with each departing toast put back in the slot it left. */
function withLeaving(live: readonly Toast[], leaving: ReadonlyArray<{ toast: Toast; slot: number }>) {
  const rows: Array<{ toast: Toast; leaving: boolean }> = live.map((toast) => ({ toast, leaving: false }));
  for (const entry of [...leaving].sort((a, b) => a.slot - b.slot)) rows.splice(Math.min(entry.slot, rows.length), 0, { toast: entry.toast, leaving: true });
  return rows;
}

function ToastRow({ toast, paused, leaving = false, onDismiss }: { toast: Toast; paused: boolean; leaving?: boolean; onDismiss: () => void }) {
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
    <div
      className={`toast toast-${toast.tone}${leaving ? " is-leaving" : ""}`}
      role={leaving ? undefined : toast.tone === "error" ? "alert" : "status"}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
    >
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
