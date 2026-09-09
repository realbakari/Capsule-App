import { useEffect, useRef, useState } from "react";
import {
  attentionLabel,
  type AttentionItem,
  type AttentionState,
  type AttentionSummary,
} from "@capsule/shared";
import { CapsuleMascot } from "./CapsuleMascot";
import { GripIcon } from "../shell/icons";

const STATE_WORD: Record<AttentionState, string> = {
  "needs-input": "Needs you",
  blocked: "Stopped",
  ready: "Ready",
  running: "Working",
};

/** A workspace-wide attention surface. The native window and status API stay unchanged. */
export function Pet() {
  const api = window.capsule;
  const [summary, setSummary] = useState<AttentionSummary>();
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(() => readPreference("capsule.pet.paused") === "true");
  const [large, setLarge] = useState(() => readPreference("capsule.pet.large") !== "false");
  const [greeting, setGreeting] = useState(false);
  const [play, setPlay] = useState<"roll" | "bounce">();
  const [reactionId, setReactionId] = useState(0);
  const [retry, setRetry] = useState(0);
  const [hidden, setHidden] = useState(document.visibilityState === "hidden");
  const greetingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bodyRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!api) return undefined;
    let alive = true;
    let loading = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (loading) { again = true; return; }
      loading = true;
      try {
        const result = await api.getPetState();
        if (alive) { setSummary(result.summary); setError(false); }
      } catch { if (alive) setError(true); }
      finally { loading = false; if (alive && again) { again = false; schedule(); } }
    };
    const schedule = () => { if (alive && !timer) timer = setTimeout(() => { timer = undefined; void load(); }, 250); };
    void load();
    const offRun = api.on("run", (payload) => {
      // Tool-output frames don't change attention. React to run state updates.
      if (payload && typeof payload === "object" && "status" in payload) schedule();
    });
    const offApproval = api.on("approval", schedule);
    const offState = api.on("state", schedule);
    return () => {
      alive = false; clearTimeout(timer);
      offRun(); offApproval(); offState();
    };
  }, [api, retry]);

  useEffect(() => {
    void api?.setPetExpanded?.(open).catch(() => setError(true));
  }, [api, open]);
  useEffect(() => { try { localStorage.setItem("capsule.pet.paused", String(paused)); localStorage.setItem("capsule.pet.large", String(large)); } catch { /* Optional preferences. */ } }, [large, paused]);
  useEffect(() => () => clearTimeout(greetingTimer.current), []);
  useEffect(() => {
    const changed = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);

  /*
   * Shown only once it has drawn. The window is transparent, so revealing it
   * on the renderer's first frame showed an empty rectangle that then became
   * a capsule — the flicker. Two frames, the same wait the main window uses.
   */
  useEffect(() => {
    let second = 0;
    const id = requestAnimationFrame(() => { second = requestAnimationFrame(() => void api?.rendererReady?.("pet")); });
    return () => { cancelAnimationFrame(id); cancelAnimationFrame(second); };
  }, [api]);

  const state: AttentionState | "idle" = error ? "idle" : summary?.state ?? "idle";
  const label = error ? "Status unavailable" : summary ? attentionLabel(summary) ?? "Nothing waiting" : "Checking activity…";

  const openSession = (item: AttentionItem) => {
    void api?.focusSession?.(item.sessionId).then(() => setOpen(false)).catch(() => setError(true));
  };

  function reactTo(action: "greet" | "roll" | "bounce") {
    clearTimeout(greetingTimer.current);
    setGreeting(action === "greet");
    setPlay(action === "greet" ? undefined : action);
    // Restart even when the same reaction is requested before it finishes.
    setReactionId((value) => value + 1);
    const duration = action === "greet" ? 1600 : action === "roll" ? 1800 : 2200;
    greetingTimer.current = setTimeout(() => { setGreeting(false); setPlay(undefined); }, duration);
  }

  return (
    <div className={`pet pet--${state}${open ? " pet--open" : ""}${paused || hidden ? " pet--paused" : ""}${large ? " pet--large" : ""}${greeting ? " pet--greeting" : ""}${play ? ` pet--${play}` : ""}`} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); bodyRef.current?.focus(); } }}>
      {/*
        * The tray, above the capsule so the pet stays where it was put. It
        * lists what the menu bar lists, because they read the same summary.
        */}
      {open ? (
        <div className="pet-tray" id="pet-tray">
          <div className="pet-tray-head">Across your workspace</div>
          {error ? <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry status</button> : !summary ? <p className="pet-tray-empty">Checking activity…</p> : summary.items.length === 0 ? (
            <p className="pet-tray-empty">No threads need attention.</p>
          ) : (
            <ul>
              {summary.items.slice(0, 6).map((item) => (
                <li key={item.sessionId}>
                  <button type="button" onClick={() => openSession(item)}>
                    <span className={`pet-dot pet-dot--${item.state}`} aria-hidden />
                    <span className="pet-tray-title">{item.title}</span>
                    <span className="pet-tray-state">{STATE_WORD[item.state]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="pet-tray-controls">
            <button type="button" onClick={() => reactTo("roll")}>Roll</button>
            <button type="button" onClick={() => reactTo("bounce")}>Bounce</button>
            <button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? "Resume motion" : "Pause motion"}</button>
            <button type="button" aria-pressed={large} onClick={() => setLarge((value) => !value)}>{large ? "Smaller" : "Larger"}</button>
            <button type="button" onClick={() => void api.togglePet(false).catch(() => setError(true))}>Hide companion</button>
          </div>
          <p className="pet-tray-empty">Restore from Settings → General or the command palette.</p>
        </div>
      ) : null}

      <div className="pet-stage">
      <div className="pet-handle" title="Drag to move companion" aria-hidden><GripIcon size={14} /></div>
      <button
        ref={bodyRef}
        type="button"
        className="pet-body"
        title={label}
        aria-label={`Capsule — ${label}`}
        aria-expanded={open}
        aria-controls="pet-tray"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.style.setProperty("--pet-look", `${Math.max(-4, Math.min(4, (event.clientX - rect.left - rect.width / 2) / 14))}px`);
          event.currentTarget.style.setProperty("--pet-look-y", `${Math.max(-2, Math.min(3, (event.clientY - rect.top - rect.height / 2) / 18))}px`);
        }}
        onPointerLeave={(event) => { event.currentTarget.style.setProperty("--pet-look", "0px"); event.currentTarget.style.setProperty("--pet-look-y", "0px"); }}
        onClick={() => setOpen((value) => !value)}
      >
        <CapsuleMascot key={reactionId} state={state} greeting={greeting} />
      </button>
      <button className="pet-wave" type="button" aria-label="Greet capsule" onClick={() => reactTo("greet")}>Greet</button>
      </div>
      <div className="pet-caption" role="status">{label}{greeting ? " · Hello!" : play === "roll" ? " · Rolling" : play === "bounce" ? " · Bouncing" : ""}</div>
    </div>
  );
}

function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
