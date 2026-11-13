import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";

/**
 * Short-lived news that is not about the thread on screen, or that carries
 * one thing to do: Undo, Open, Restore prompt.
 *
 * A thread's own errors stay inline above its transcript (the spec's thread
 * notice): they belong to that thread and wait for it. A toast is for what
 * happened elsewhere or what just happened here and can be taken back.
 */
export type ToastTone = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
  /** ⌘Z outside a text field runs this, while the toast is the newest undoable one. */
  undo?: boolean;
}

export interface ToastInput {
  /** A toast with the same key replaces the one on screen instead of stacking. */
  key?: string;
  tone?: ToastTone;
  title: string;
  detail?: string;
  action?: ToastAction;
  /** Milliseconds on screen; 0 keeps it until dismissed. Errors default to 8 s, the rest to 5 s, undo to 10 s. */
  timeoutMs?: number;
}

export interface Toast extends Required<Pick<ToastInput, "tone" | "title">> {
  id: string;
  key: string;
  detail?: string;
  action?: ToastAction;
  timeoutMs: number;
}

/** More than this and the oldest leave; a stack is a glance, not a log. */
export const TOAST_LIMIT = 3;

type ToastEvent = { type: "show"; toast: Toast } | { type: "dismiss"; id: string };

export function toastReducer(toasts: readonly Toast[], event: ToastEvent): Toast[] {
  if (event.type === "dismiss") return toasts.filter((toast) => toast.id !== event.id);
  const rest = toasts.filter((toast) => toast.key !== event.toast.key);
  return [...rest, event.toast].slice(-TOAST_LIMIT);
}

let counter = 0;

export function createToast(input: ToastInput): Toast {
  const id = `toast-${++counter}`;
  const tone = input.tone ?? "info";
  const fallback = input.action?.undo ? 10_000 : tone === "error" ? 8_000 : 5_000;
  return {
    id,
    key: input.key ?? id,
    tone,
    title: input.title,
    detail: input.detail,
    action: input.action,
    timeoutMs: input.timeoutMs ?? fallback,
  };
}

interface ToastsValue {
  toasts: Toast[];
  /** Shows a toast and returns its id. */
  show: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  /** Removes the toast holding this key, if one is on screen. */
  dismissKey: (key: string) => void;
}

const ToastContext = createContext<ToastsValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);
  const show = useCallback((input: ToastInput) => {
    const toast = createToast(input);
    dispatch({ type: "show", toast });
    return toast.id;
  }, []);
  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);
  const value = useMemo<ToastsValue>(() => ({
    toasts,
    show,
    dismiss,
    dismissKey: (key) => {
      const found = toasts.find((toast) => toast.key === key);
      if (found) dispatch({ type: "dismiss", id: found.id });
    },
  }), [toasts, show, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

const NO_TOASTS: ToastsValue = { toasts: [], show: () => "", dismiss: () => undefined, dismissKey: () => undefined };

/** Outside a provider (a test render, the public site) toasts are dropped. */
export function useToasts(): ToastsValue {
  return useContext(ToastContext) ?? NO_TOASTS;
}
