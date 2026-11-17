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
  /** A lesser choice beside `action`, such as Release notes beside Retry. */
  secondaryAction?: ToastAction;
  /** Milliseconds on screen; 0 keeps it until dismissed. Errors default to 8 s, the rest to 5 s, undo to 10 s. */
  timeoutMs?: number;
}

export interface Toast extends Required<Pick<ToastInput, "tone" | "title">> {
  id: string;
  key: string;
  detail?: string;
  action?: ToastAction;
  secondaryAction?: ToastAction;
  timeoutMs: number;
}

/** More than this on screen and one makes room; a stack is a glance, not a log. */
export const TOAST_LIMIT = 3;

/** On screen, and held back until a slot frees. */
export interface ToastStack {
  visible: Toast[];
  waiting: Toast[];
}

export const EMPTY_TOAST_STACK: ToastStack = { visible: [], waiting: [] };

/**
 * What leaving early costs: an undo that cannot be taken back, an action not
 * taken, a standing notice or an error not read, or a passing line of news.
 */
function stake(toast: Toast): number {
  if (toast.action?.undo) return 3;
  if (toast.action || toast.secondaryAction) return 2;
  if (toast.tone === "error" || toast.timeoutMs === 0) return 1;
  return 0;
}

type ToastEvent = { type: "show"; toast: Toast } | { type: "dismiss"; id: string };

/**
 * A full stack makes room by dropping its oldest toast with the least at
 * stake. A newcomer with less at stake than everything on screen waits for a
 * slot instead, so news never pushes an Undo off the screen.
 */
export function toastReducer(stack: ToastStack, event: ToastEvent): ToastStack {
  if (event.type === "dismiss") {
    return promote({
      visible: stack.visible.filter((toast) => toast.id !== event.id),
      waiting: stack.waiting.filter((toast) => toast.id !== event.id),
    });
  }
  const incoming = event.toast;
  const visible = stack.visible.filter((toast) => toast.key !== incoming.key);
  const waiting = stack.waiting.filter((toast) => toast.key !== incoming.key);
  if (visible.length < TOAST_LIMIT) return promote({ visible: [...visible, incoming], waiting });
  const least = Math.min(...visible.map(stake));
  if (stake(incoming) < least) return { visible, waiting: [...waiting, incoming].slice(-TOAST_LIMIT) };
  const evicted = visible.findIndex((toast) => stake(toast) === least);
  return { visible: [...visible.slice(0, evicted), ...visible.slice(evicted + 1), incoming], waiting };
}

function promote(stack: ToastStack): ToastStack {
  const room = TOAST_LIMIT - stack.visible.length;
  if (room <= 0 || stack.waiting.length === 0) return stack;
  return { visible: [...stack.visible, ...stack.waiting.slice(0, room)], waiting: stack.waiting.slice(room) };
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
    secondaryAction: input.secondaryAction,
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
  const [stack, dispatch] = useReducer(toastReducer, EMPTY_TOAST_STACK);
  const show = useCallback((input: ToastInput) => {
    const toast = createToast(input);
    dispatch({ type: "show", toast });
    return toast.id;
  }, []);
  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);
  const value = useMemo<ToastsValue>(() => ({
    toasts: stack.visible,
    show,
    dismiss,
    dismissKey: (key) => {
      const found = [...stack.visible, ...stack.waiting].find((toast) => toast.key === key);
      if (found) dispatch({ type: "dismiss", id: found.id });
    },
  }), [stack, show, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

const NO_TOASTS: ToastsValue = { toasts: [], show: () => "", dismiss: () => undefined, dismissKey: () => undefined };

/** Outside a provider (a test render, the public site) toasts are dropped. */
export function useToasts(): ToastsValue {
  return useContext(ToastContext) ?? NO_TOASTS;
}
