import { useEffect, useRef, useState } from "react";
import { useToasts, type Toast, type ToastAction } from "../../lib/toasts";
import { AlertTriangleIcon, CheckIcon, CopyIcon, XIcon } from "../shell/icons";
import "./toasts.css";

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], .xterm"));
}

/**
 * Whether anyone can be reading the window. A toast's time runs only then, so
 * news that lands while Capsule is hidden or behind another app is still
 * there when they come back.
 */
function useWindowActive(): boolean {
  const [active, setActive] = useState(() => document.visibilityState === "visible" && document.hasFocus());
  useEffect(() => {
    const visibility = () => setActive(document.visibilityState === "visible" && document.hasFocus());
    const focus = () => setActive(document.visibilityState === "visible");
    const blur = () => setActive(false);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return active;
}

/**
 * The stack sits under the titlebar on the right, clear of the composer and
 * every control below it; newest last. Timers pause while the pointer or
 * focus is inside, so a toast is never pulled out from under someone reaching
 * for its button, and while the window is hidden or in the background.
 */
/** How long a dismissed toast stays to fade out; matches --motion-fast. */
const EXIT_MS = 140;

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  const [engaged, setEngaged] = useState(false);
  const active = useWindowActive();
  const paused = engaged || !active;
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
      onPointerEnter={() => setEngaged(true)}
      onPointerLeave={() => setEngaged(false)}
      onFocus={() => setEngaged(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEngaged(false); }}
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
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const text = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (paused || expanded || toast.timeoutMs <= 0) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(1_500, remaining.current - (Date.now() - started));
    };
  }, [paused, expanded, toast.timeoutMs]);
  /* Only text the clamp actually cut earns a way to read the rest. */
  useEffect(() => {
    const node = text.current;
    if (!node || expanded) return;
    const measure = () => setClipped(Array.from(node.children).some((child) => child.scrollHeight > child.clientHeight + 1 || child.scrollWidth > child.clientWidth + 1));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    // A late web font can push text past the clamp without changing the clamped box's size.
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [toast.title, toast.detail, expanded]);

  const run = (action: ToastAction) => { onDismiss(); void action.run(); };
  return (
    <div
      className={`toast toast-${toast.tone}${leaving ? " is-leaving" : ""}${expanded ? " is-expanded" : ""}`}
      role={leaving ? undefined : toast.tone === "error" ? "alert" : "status"}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
    >
      {toast.tone === "error" ? <AlertTriangleIcon size={14} className="toast-icon" /> : toast.tone === "success" ? <CheckIcon size={14} className="toast-icon" /> : null}
      <div className="toast-text" ref={text}>
        <span className="toast-title" title={expanded ? undefined : toast.title}>{toast.title}</span>
        {toast.detail && <span className="toast-detail">{toast.detail}</span>}
        {(clipped || expanded) && (
          <button type="button" className="toast-more" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
      {toast.tone === "error" && <CopyErrorButton toast={toast} />}
      {toast.secondaryAction && (
        <button type="button" className="toast-action is-secondary" onClick={() => run(toast.secondaryAction!)}>
          {toast.secondaryAction.label}
        </button>
      )}
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => run(toast.action!)}
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

/** An error is often pasted into an issue or a chat; copying beats retyping it from a toast that is leaving. */
function CopyErrorButton({ toast }: { toast: Toast }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);
  const label = copied ? "Copied error" : "Copy error";
  return (
    <button
      type="button"
      className="icon-btn toast-copy"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(toast.detail ? `${toast.title}\n${toast.detail}` : toast.title).then(() => setCopied(true), () => undefined);
      }}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
    </button>
  );
}
