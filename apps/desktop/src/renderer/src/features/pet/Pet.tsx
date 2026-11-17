import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AttentionItem, AttentionSummary } from "@capsule/shared";
import { CapsuleMascot } from "./CapsuleMascot";
import { GripIcon } from "../shell/icons";
import { REACTION_DURATION, captionFor, gaze, isReactionTrack, moodFor, nextGlance, stateWord, type CompanionState, type PetCommand, type PetReaction } from "./behavior";
import { usePetBehavior } from "./usePetBehavior";
import { PetVoiceControls } from "./PetVoiceControls";

/** Parts of the window that take the pointer; everywhere else clicks reach the desktop. */
const INTERACTIVE = ".pet-body, .pet-chrome, .pet-caption, .pet-tray";

/*
 * Anticipation, then the new pose: a squash into the ground, a small rise and
 * a settle. Played on its own layer, so it never interrupts breathing or a
 * gesture already running.
 */
const STATE_CHANGE: Keyframe[] = [
  { transform: "none" },
  { transform: "translateY(1.5px) scale(1.05, 0.93)", offset: 0.28 },
  { transform: "translateY(-3px) scale(0.97, 1.04)", offset: 0.6 },
  { transform: "none" },
];

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
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLButtonElement>(null);
  const shiftRef = useRef<SVGGElement>(null);
  const state: CompanionState = error ? "idle" : summary?.state ?? "idle";
  const still = paused || reducedMotion;
  const idleReaction = useCallback((kind: PetReaction) => setReaction(current => current ?? { kind }), []);
  const behavior = usePetBehavior({ state, available: Boolean(summary) && !error, autonomous, motionPaused: still, hidden, open, react: idleReaction });
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
    for (const track of rootRef.current?.getAnimations({ subtree: true }) ?? []) {
      if (track instanceof CSSAnimation && isReactionTrack(track.animationName)) track.currentTime = 0;
    }
    const timer = setTimeout(() => setReaction(undefined), REACTION_DURATION[reaction.kind]);
    return () => clearTimeout(timer);
  }, [reaction]);
  useEffect(() => {
    const changed = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);

  // A state change is an event, so it gets a beat of its own; the first read is not.
  const shown = useRef<CompanionState | undefined>(undefined);
  useEffect(() => {
    const previous = shown.current;
    shown.current = state;
    if (previous === undefined || previous === state || still || hidden) return;
    shiftRef.current?.animate?.(STATE_CHANGE, { duration: 560, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, [state, still, hidden]);

  /*
   * Gaze. The pointer leads while it is over the window (forwarded moves count
   * even while clicks pass through); otherwise the eyes wander on an uneven
   * schedule. Both write the same three properties, so CSS eases between them.
   */
  const pointerAt = useRef(0);
  const look = useCallback((x: number, y: number, lean: number) => {
    const style = rootRef.current?.style;
    if (!style) return;
    style.setProperty("--look-x", x.toFixed(2));
    style.setProperty("--look-y", y.toFixed(2));
    style.setProperty("--lean", `${lean.toFixed(2)}deg`);
  }, []);
  useEffect(() => {
    if (still || hidden || behavior.resting) { look(0, 0, 0); return undefined; }
    let timer: ReturnType<typeof setTimeout>;
    const wander = () => {
      const next = nextGlance();
      timer = setTimeout(() => {
        if (performance.now() - pointerAt.current < 2500) return wander();
        look(next.look.x, next.look.y, next.look.x * 0.4);
        timer = setTimeout(() => { if (performance.now() - pointerAt.current >= 2500) look(0, 0, 0); wander(); }, next.hold);
      }, next.wait);
    };
    wander();
    return () => clearTimeout(timer);
  }, [still, hidden, behavior.resting, look]);

  /*
   * Clicks through the empty parts of the window. The window is a transparent
   * rectangle larger than the capsule; without this it swallowed clicks meant
   * for whatever sat behind it.
   */
  const passthrough = useRef(false);
  const setPassthrough = useCallback((value: boolean) => {
    if (passthrough.current === value) return;
    passthrough.current = value;
    void api?.setPetPassthrough?.(value).catch(() => { passthrough.current = !value; });
  }, [api]);
  useEffect(() => { if (open) setPassthrough(false); }, [open, setPassthrough]);
  useEffect(() => {
    let frame = 0;
    const moved = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      setPassthrough(!open && !target?.closest(INTERACTIVE));
      pointerAt.current = performance.now();
      if (frame || still || behavior.resting) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = bodyRef.current?.getBoundingClientRect();
        if (!rect) return;
        const next = gaze(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height * 0.32));
        look(next.x, next.y, next.lean);
      });
    };
    const left = () => { setPassthrough(!open); pointerAt.current = 0; };
    document.addEventListener("pointermove", moved);
    document.documentElement.addEventListener("pointerleave", left);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointermove", moved); document.documentElement.removeEventListener("pointerleave", left); };
  }, [open, still, behavior.resting, look, setPassthrough]);

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

  const caption = captionFor(summary, error);
  const label = caption.detail ? `${caption.text} · ${caption.detail}` : caption.text;

  const openSession = (sessionId: string) => {
    void api?.focusSession?.(sessionId).then(() => setOpen(false)).catch(() => setError(true));
  };

  const greeting = reaction?.kind === "greet";
  const play = reaction?.kind;
  const mood = moodFor(state, { greeting, resting: behavior.resting, yawning: play === "yawn" });
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

  const classes = ["pet", `pet--${state}`, error && "pet--error", open && "pet--open", paused && "pet--paused", hidden && "pet--hidden", large && "pet--large", greeting && "pet--greeting", play && play !== "greet" && `pet--${play}`, behavior.resting && "pet--resting"];
  return (
    <div ref={rootRef} className={classes.filter(Boolean).join(" ")} onPointerEnter={behavior.wake} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); bodyRef.current?.focus(); } }}>
      {/*
        * The tray, above the capsule so the pet stays where it was put. It
        * lists what the menu bar lists, because they read the same summary.
        */}
      {open ? (
        <div className="pet-tray" id="pet-tray">
          <div className="pet-tray-head">
            <span>Threads</span>
            {summary && !error ? <span className="pet-tray-count">{summary.items.length === 0 ? "All quiet" : `${summary.items.length} active`}</span> : null}
          </div>
          {error ? <button type="button" className="pet-tray-retry" onClick={() => setRetry((value) => value + 1)}>Retry status</button> : !summary ? <p className="pet-tray-empty">Checking activity…</p> : summary.items.length === 0 ? (
            <p className="pet-tray-empty">No threads need attention.</p>
          ) : (
            <ul className="pet-tray-list">
              {summary.items.slice(0, 5).map((item: AttentionItem) => (
                <li key={item.sessionId}>
                  <button type="button" className="pet-tray-row" onClick={() => openSession(item.sessionId)}>
                    <span className={`pet-dot pet-dot--${item.state}`} aria-hidden />
                    <span className="pet-tray-title">{item.title}</span>
                    <span className="pet-tray-state">{stateWord(item.state)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="pet-tray-section" role="group" aria-label="Play">
            <button type="button" onClick={() => reactTo("roll")}>Roll</button>
            <button type="button" onClick={() => reactTo("bounce")}>Bounce</button>
            <button type="button" onClick={() => reactTo("dance")}>Dance</button>
          </div>
          <div className="pet-tray-section" role="group" aria-label="Companion">
            <button type="button" onClick={() => setPaused((value) => !value)}>{paused ? "Resume motion" : "Pause motion"}</button>
            <button type="button" onClick={() => setLarge((value) => !value)}>{large ? "Smaller" : "Larger"}</button>
            <button type="button" className="pet-tray-hide" title="Show it again from Settings → General or the command palette" onClick={() => void api.togglePet(false).catch(() => setError(true))}>Hide companion</button>
          </div>
          <label className="pet-option"><input type="checkbox" checked={autonomous} onChange={event => setAutonomous(event.target.checked)} /> Idle gestures and celebrations</label>
          <PetVoiceControls onCommand={onCommand} state={state} available={Boolean(summary) && !error} />
        </div>
      ) : null}

      <div className="pet-stage">
        <button
          ref={bodyRef}
          type="button"
          className="pet-body"
          title={label}
          aria-label={`Capsule — ${label}`}
          aria-expanded={open}
          aria-controls="pet-tray"
          onClick={() => { behavior.wake(); setOpen((value) => !value); }}
        >
          <CapsuleMascot state={state} mood={mood} shiftRef={shiftRef} />
        </button>
        <div className="pet-chrome">
          <div className="pet-handle" title="Drag to move companion" aria-hidden><GripIcon size={14} /></div>
          <button className="pet-wave" type="button" aria-label="Greet capsule" onClick={() => reactTo("greet")}>Greet</button>
        </div>
      </div>
      <div className="pet-caption-slot" role="status">
        {caption.sessionId ? (
          <button type="button" className="pet-caption" title={`Open ${caption.detail}`} onClick={() => openSession(caption.sessionId!)}>
            <CaptionBody state={summary?.items[0]?.state} caption={caption} greeting={greeting} />
          </button>
        ) : (
          <div className="pet-caption"><CaptionBody state={error ? undefined : summary?.items[0]?.state} caption={caption} greeting={greeting} /></div>
        )}
      </div>
    </div>
  );
}

function CaptionBody({ state, caption, greeting }: { state?: AttentionItem["state"]; caption: ReturnType<typeof captionFor>; greeting: boolean }) {
  return <>
    {state ? <span className={`pet-dot pet-dot--${state}`} aria-hidden /> : null}
    <span className="pet-caption-text">{caption.text}{greeting ? " · Hello!" : ""}</span>
    {caption.detail ? <span className="pet-caption-detail">{caption.detail}</span> : null}
    {caption.more ? <span className="pet-caption-more">+{caption.more}</span> : null}
  </>;
}

function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
