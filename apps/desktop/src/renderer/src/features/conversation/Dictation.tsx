import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { DictationEvent, DictationOutcome, DictationSettingsPane } from "@capsule/shared";
import { anchorAt, dictationUnavailableReason, isDictating, recordingClock, spliceDictation, TOGGLE_DICTATION_EVENT, type DictationState } from "../../lib/dictation";
import { MicIcon, StopIcon, XIcon } from "../shell/icons";
import "./dictation.css";

interface DictationApi {
  isDesktop?: boolean;
  platform?: string;
  startDictation?: () => Promise<DictationOutcome>;
  finishDictation?: () => Promise<void>;
  cancelDictation?: () => Promise<void>;
  openDictationSettings?: (pane: DictationSettingsPane) => Promise<void>;
  on: (event: "dictation", handler: (payload: unknown) => void) => () => void;
}

const SETTINGS_LABEL: Record<DictationSettingsPane, string> = {
  microphone: "Open Microphone settings",
  speech: "Open Speech Recognition settings",
  dictation: "Open Keyboard settings",
};

function parseEvent(payload: unknown): DictationEvent | undefined {
  if (!payload || typeof payload !== "object" || !("phase" in payload)) return undefined;
  return payload as DictationEvent;
}

/**
 * Composer dictation: spoken text replaces itself at the caret as it refines,
 * Escape puts the draft back, and the chord or the button keeps it.
 */
export function useDictation({ api, draft, setDraft, field, scope }: {
  api: DictationApi;
  draft: string;
  setDraft: (value: string) => void;
  field: RefObject<HTMLTextAreaElement | null>;
  /** Changing thread ends dictation; its text must not land in another thread's draft. */
  scope: string;
}) {
  const [state, setState] = useState<DictationState>({ phase: "idle" });
  const generation = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const caret = useRef<number | undefined>(undefined);

  const place = useCallback((value: { draft: string; caret: number }) => {
    caret.current = value.caret;
    setDraft(value.draft);
  }, [setDraft]);

  useLayoutEffect(() => {
    if (caret.current === undefined || !field.current) return;
    field.current.setSelectionRange(caret.current, caret.current);
    caret.current = undefined;
  });

  const cancel = useCallback(() => {
    const current = stateRef.current;
    if (!isDictating(current)) return;
    generation.current++;
    void api.cancelDictation?.().catch(() => {});
    place({ draft: current.anchor.original, caret: current.anchor.before.length });
    setState({ phase: "idle" });
    field.current?.focus();
  }, [api, field, place]);

  const finish = useCallback(() => {
    const current = stateRef.current;
    if (current.phase === "starting") { cancel(); return; }
    if (current.phase !== "listening") return;
    setState({ phase: "finishing", anchor: current.anchor, text: current.text });
    void api.finishDictation?.().catch(() => {});
  }, [api, cancel]);

  const start = useCallback(() => {
    const unavailable = dictationUnavailableReason(api);
    if (unavailable || !api.startDictation) { setState({ phase: "error", message: unavailable ?? "Dictation is unavailable in this window." }); return; }
    const element = field.current;
    const value = draftRef.current;
    const anchor = anchorAt(value, element?.selectionStart ?? value.length, element?.selectionEnd ?? value.length);
    const run = ++generation.current;
    setState({ phase: "starting", anchor });
    const off = api.on("dictation", (payload) => {
      const event = parseEvent(payload);
      if (!event || run !== generation.current) return;
      if (event.phase === "listening") setState({ phase: "listening", anchor, text: "", level: 0, startedAt: Date.now(), limitMs: event.limitMs });
      else if (event.phase === "partial") {
        place(spliceDictation(anchor, event.text));
        setState((current) => current.phase === "listening" || current.phase === "finishing" ? { ...current, text: event.text } : current);
      } else if (event.phase === "level") setState((current) => current.phase === "listening" ? { ...current, level: event.value } : current);
    });
    void api.startDictation().then((outcome): DictationOutcome => outcome, (error: unknown): DictationOutcome => ({
      kind: "error", message: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "Dictation stopped unexpectedly.",
    })).then((outcome) => {
      off();
      if (run !== generation.current) return;
      generation.current++;
      if (outcome.kind === "text") place(spliceDictation(anchor, outcome.text));
      else place({ draft: anchor.original, caret: anchor.before.length });
      setState(outcome.kind === "error" ? { phase: "error", message: outcome.message, ...(outcome.settings ? { settings: outcome.settings } : {}) } : { phase: "idle" });
      field.current?.focus();
    });
  }, [api, field, place]);

  const toggle = useCallback(() => {
    const phase = stateRef.current.phase;
    if (phase === "idle" || phase === "error") start();
    else if (phase === "starting" || phase === "listening") finish();
  }, [finish, start]);

  useEffect(() => {
    const onToggle = () => toggle();
    window.addEventListener(TOGGLE_DICTATION_EVENT, onToggle);
    return () => window.removeEventListener(TOGGLE_DICTATION_EVENT, onToggle);
  }, [toggle]);

  const active = isDictating(state);
  useEffect(() => {
    if (!active) return;
    // Capture phase, so Escape cancels dictation rather than stopping a running turn,
    // and Enter keeps the text rather than sending a half-heard prompt.
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); }
      else if (event.key === "Enter" && !event.shiftKey && event.target === field.current) { event.preventDefault(); event.stopPropagation(); finish(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, cancel, finish, field]);

  useEffect(() => () => {
    if (!isDictating(stateRef.current)) return;
    generation.current++;
    void api.cancelDictation?.().catch(() => {});
  }, [api, scope]);
  useEffect(() => { setState((current) => isDictating(current) ? { phase: "idle" } : current); }, [scope]);

  return { state, active, toggle, cancel, finish, dismiss: () => setState({ phase: "idle" }) };
}

export function DictationButton({ state, unavailable, onToggle }: { state: DictationState; unavailable?: string; onToggle: () => void }) {
  const recording = state.phase === "listening" || state.phase === "starting";
  const label = state.phase === "finishing" ? "Finishing dictation" : recording ? "Finish dictation" : "Dictate";
  return <button type="button" className={`icon-btn dictation-btn${recording ? " is-recording" : ""}${unavailable ? " is-unavailable" : ""}`}
    aria-label={label} aria-pressed={recording} title={unavailable ?? (recording ? "Finish dictation · ⇧⌘L · Esc cancels" : "Dictate · ⇧⌘L")}
    disabled={state.phase === "finishing"}
    onMouseDown={(event) => event.preventDefault()} onClick={onToggle}>
    {recording ? <StopIcon size={11} /> : <MicIcon size={15} />}
  </button>;
}

export function DictationStatus({ state, api, onCancel, onFinish, onDismiss }: {
  state: DictationState;
  api: DictationApi;
  onCancel: () => void;
  onFinish: () => void;
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const listening = state.phase === "listening";
  useEffect(() => {
    if (!listening) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [listening]);
  if (state.phase === "idle") return null;
  if (state.phase === "error") {
    const settings = state.settings;
    return <div className="dictation-status is-error" role="alert">
      <span className="dictation-message">{state.message}</span>
      {settings && api.openDictationSettings && <button type="button" className="ghost" onClick={() => void api.openDictationSettings?.(settings).catch(() => {})}>{SETTINGS_LABEL[settings]}</button>}
      <button type="button" className="icon-btn dictation-dismiss" aria-label="Dismiss dictation message" onClick={onDismiss}><XIcon size={12} /></button>
    </div>;
  }
  const clock = listening ? recordingClock(now - state.startedAt, state.limitMs) : undefined;
  const level = listening ? state.level : 0;
  return <div className={`dictation-status${clock?.ending ? " is-ending" : ""}`} role="status" aria-live="polite">
    <span className={`dictation-dot${listening ? " is-live" : ""}`} aria-hidden />
    <span className="dictation-message">{state.phase === "starting" ? "Starting dictation…" : state.phase === "finishing" ? "Finishing…" : "Listening"}</span>
    {listening && <span className="dictation-level" aria-hidden>{[0.15, 0.35, 0.6, 0.85].map((step) => <i key={step} className={level >= step ? "on" : undefined} />)}</span>}
    {clock && <span className="dictation-clock" aria-label={clock.ending ? clock.label : `Recording for ${clock.label}`}>{clock.label}</span>}
    <span className="dictation-actions">
      {state.phase !== "finishing" && <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={onCancel}>Cancel <kbd>Esc</kbd></button>}
      {listening && <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={onFinish}>Done <kbd>↵</kbd></button>}
    </span>
  </div>;
}

