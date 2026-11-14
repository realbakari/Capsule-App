import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseSnoozeUntil, snoozePresets } from "@capsule/shared";
import { useModalFocus } from "../../lib/modal-focus";
import { formatWakeTime, useThreadTriage } from "../../lib/thread-triage";
import { useWorkspace } from "../../lib/workspace";
import { SNOOZE_THREAD_EVENT } from "./session-actions";
import "./triage.css";

/** `<input type="datetime-local">` speaks local wall time without a zone. */
function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Snooze a thread: a handful of times a person thinks in, and any other.
 * Numbers pick a preset, so the whole thing is two keystrokes from a menu.
 */
export function SnoozeDialog() {
  const { sessions, settings } = useWorkspace();
  const { snooze } = useThreadTriage();
  const [target, setTarget] = useState<string>();
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useCallback(() => { setTarget(undefined); setError(undefined); }, []);
  useModalFocus(dialog, Boolean(target), close);

  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id !== "string") return;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      setCustom(localInputValue(tomorrow));
      setError(undefined);
      setTarget(id);
    };
    window.addEventListener(SNOOZE_THREAD_EVENT, open);
    return () => window.removeEventListener(SNOOZE_THREAD_EVENT, open);
  }, []);

  const presets = useMemo(() => (target ? snoozePresets() : []), [target]);
  const title = sessions.find((item) => item.id === target)?.title;
  if (!target) return null;

  const choose = (at: Date | string) => {
    void snooze(target, at);
    close();
  };
  const submitCustom = () => {
    try {
      choose(parseSnoozeUntil(new Date(custom).toISOString()));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <div className="palette-backdrop center" onClick={close}>
      <div
        className="dialog snooze-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="snooze-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.target instanceof HTMLInputElement) return;
          const index = Number(event.key) - 1;
          if (Number.isInteger(index) && presets[index]) { event.preventDefault(); choose(presets[index]!.at); }
        }}
      >
        <h3 id="snooze-title">Snooze until…</h3>
        {title && <p className="snooze-subject truncate">{title}</p>}
        <div className="snooze-presets" role="group" aria-label="Snooze presets">
          {presets.map((preset, index) => (
            <button key={preset.id} type="button" className="snooze-preset" onClick={() => choose(preset.at)}>
              <kbd>{index + 1}</kbd>
              <span>{preset.label}</span>
              <span className="snooze-preset-time">{formatWakeTime(preset.at.toISOString(), new Date(), settings?.timeFormat)}</span>
            </button>
          ))}
        </div>
        <form className="snooze-custom" onSubmit={(event) => { event.preventDefault(); submitCustom(); }}>
          <label htmlFor="snooze-custom-time">Pick a time</label>
          <div className="snooze-custom-row">
            <input
              id="snooze-custom-time"
              type="datetime-local"
              value={custom}
              min={localInputValue(new Date())}
              onChange={(event) => { setCustom(event.target.value); setError(undefined); }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "snooze-custom-error" : undefined}
            />
            <button type="submit" className="send">Snooze</button>
          </div>
          {error && <p id="snooze-custom-error" className="snooze-error" role="alert">{error}</p>}
        </form>
        <p className="snooze-hint">It comes back on its own at that time, or as soon as its agent starts a new turn.</p>
      </div>
    </div>
  );
}
