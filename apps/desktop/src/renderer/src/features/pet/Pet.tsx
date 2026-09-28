import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  attentionLabel,
  type AttentionItem,
  type AttentionState,
  type AttentionSummary,
} from "@capsule/shared";
import { CapsuleMascot } from "./CapsuleMascot";
import { GripIcon } from "../shell/icons";
import { REACTION_DURATION, REACTION_TRACKS, type PetReaction, type PetCommand } from "./behavior";
import { usePetBehavior } from "./usePetBehavior";
import { PetVoiceControls } from "./PetVoiceControls";

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
  const [reaction, setReaction] = useState<{ kind: PetReaction }>();
  const [autonomous, setAutonomous] = useState(() => readPreference("capsule.pet.autonomous") !== "false");
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [retry, setRetry] = useState(0);
  const [hidden, setHidden] = useState(document.visibilityState === "hidden");
  const bodyRef = useRef<HTMLButtonElement>(null);
  const state: AttentionState | "idle" = error ? "idle" : summary?.state ?? "idle";
  const idleReaction = useCallback((kind: PetReaction) => setReaction(current => current ?? { kind }), []);
  const behavior = usePetBehavior({ state, available: Boolean(summary) && !error, autonomous, motionPaused: paused || reducedMotion, hidden, open, react: idleReaction });
  useEffect(() => { if (error || state === "needs-input" || state === "blocked") setReaction(undefined); }, [error, state]);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReducedMotion(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => { try { localStorage.setItem("capsule.pet.autonomous", String(autonomous)); } catch { /* Optional preference. */ } }, [autonomous]);

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
  useLayoutEffect(() => {
    if (!reaction) return;
    // Replay only the gesture. Eyes, breathing and idle motion keep their phase.
    for (const track of bodyRef.current?.getAnimations({ subtree: true }) ?? []) {
      if (track instanceof CSSAnimation && REACTION_TRACKS.has(track.animationName)) track.currentTime = 0;
    }
    const timer = setTimeout(() => setReaction(undefined), REACTION_DURATION[reaction.kind]);
    return () => clearTimeout(timer);
  }, [reaction]);
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

  const label = error ? "Status unavailable" : summary ? attentionLabel(summary) ?? "Nothing waiting" : "Checking activity…";

  const openSession = (item: AttentionItem) => {
    void api?.focusSession?.(item.sessionId).then(() => setOpen(false)).catch(() => setError(true));
  };

  const greeting = reaction?.kind === "greet";
  const play = reaction?.kind === "greet" ? undefined : reaction?.kind;
  function reactTo(kind: PetReaction) { behavior.wake(); setReaction({ kind }); }
  function onCommand(command: PetCommand) {
    switch (command.kind) {
      case "gesture": reactTo(command.reaction); break;
      case "tasks": setOpen(true); break;
      case "pause": setPaused(true); break;
      case "resume": setPaused(false); behavior.wake(); break;
      case "sleep": setReaction(undefined); behavior.rest(); break;
      case "wake": behavior.wake(); break;
      case "status": break; // The voice control reads counts through main.
    }
  }

  return (
    <div className={`pet pet--${state}${error ? " pet--error" : ""}${open ? " pet--open" : ""}${paused || hidden ? " pet--paused" : ""}${large ? " pet--large" : ""}${greeting ? " pet--greeting" : ""}${play ? ` pet--${play}` : ""}${behavior.resting ? " pet--resting" : ""}`} onPointerEnter={behavior.wake} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); bodyRef.current?.focus(); } }}>
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
            <button type="button" onClick={() => reactTo("dance")}>Dance</button>
            <button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? "Resume motion" : "Pause motion"}</button>
            <button type="button" aria-pressed={large} onClick={() => setLarge((value) => !value)}>{large ? "Smaller" : "Larger"}</button>
            <button type="button" onClick={() => void api.togglePet(false).catch(() => setError(true))}>Hide companion</button>
          </div>
          <label className="pet-option"><input type="checkbox" checked={autonomous} onChange={event => setAutonomous(event.target.checked)} /> Idle gestures and celebrations</label>
          <PetVoiceControls onCommand={onCommand} state={state} available={Boolean(summary) && !error} />
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
        onClick={() => { behavior.wake(); setOpen((value) => !value); }}
      >
        <CapsuleMascot state={state} greeting={greeting} resting={behavior.resting} yawning={play === "yawn"} />
      </button>
      <button className="pet-wave" type="button" aria-label="Greet capsule" onClick={() => reactTo("greet")}>Greet</button>
      </div>
      <div className="pet-caption" role="status">{label}{greeting ? " · Hello!" : ""}</div>
    </div>
  );
}

function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
