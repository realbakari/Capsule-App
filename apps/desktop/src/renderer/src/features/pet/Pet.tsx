import { useEffect, useRef, useState } from "react";
import {
  attentionLabel,
  type AttentionItem,
  type AttentionState,
  type AttentionSummary,
} from "@capsule/shared";

/*
 * The pet: a small window that floats above everything and says whether
 * anything wants you.
 *
 * Capsule runs turns that take minutes, and the moment you look away the app
 * has no way to reach you short of a notification you will miss. This is the
 * always-visible half of the attention model — the same summary the menu bar
 * reads, with a face on it.
 *
 * A small cat with a capsule-shaped body. Separate limbs let the mascot walk,
 * stretch and play, without repainting a sprite sheet or polling a timer.
 */

const FACES: Record<AttentionState | "idle", { fill: string; ring: string; mood: string }> = {
  // Amber asks for attention; the caption distinguishes it without colour.
  "needs-input": { fill: "#d6a03c", ring: "#f0c268", mood: "asks" },
  blocked: { fill: "#c96a6a", ring: "#e08a8a", mood: "stopped" },
  ready: { fill: "#6fae68", ring: "#8fcf88", mood: "done" },
  running: { fill: "#5b8bd0", ring: "#7fa9e6", mood: "works" },
  idle: { fill: "#4a4a4f", ring: "#65656b", mood: "rests" },
};

/**
 * The capsule itself.
 *
 * Eyes carry the state, not colour alone: a colour-blind reader gets the same
 * message from the shape, and a static frame still reads correctly when the
 * system asks for reduced motion.
 */
function Capsule({ state, count }: { state: AttentionState | "idle"; count: number }) {
  const face = FACES[state];
  return (
    <svg viewBox="0 0 120 112" className={`pet-capsule pet-capsule--${state}`} aria-hidden>
      <defs>
        <linearGradient id="petBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f4f0e5" />
          <stop offset="100%" stopColor="#c8c3b8" />
        </linearGradient>
      </defs>

      <ellipse className="pet-shadow" cx="60" cy="104" rx="30" ry="4" fill="#000" opacity=".22" />
      <g className="pet-rig">
        <path className="pet-tail" d="M81 81 C114 91 116 45 97 50" fill="none" stroke="#c8c3b8" strokeWidth="9" strokeLinecap="round" />
        <g className="pet-leg pet-leg-back"><path d="M74 77 L81 98" stroke="#b4afa5" strokeWidth="11" strokeLinecap="round" /><ellipse cx="83" cy="99" rx="9" ry="5" fill="#d8d2c7" /></g>
        <g className="pet-torso"><rect x="35" y="48" width="48" height="48" rx="24" fill="url(#petBody)" /><ellipse cx="57" cy="74" rx="15" ry="18" fill="#faf6ed" /></g>
        <g className="pet-leg pet-leg-front"><path d="M48 77 L41 98" stroke="#e2ddd3" strokeWidth="11" strokeLinecap="round" /><ellipse cx="40" cy="99" rx="9" ry="5" fill="#f4f0e5" /></g>
        <g className="pet-head">
          <path className="pet-ear pet-ear-left" d="M35 33 L33 10 Q34 6 39 11 L53 26" fill="#e2ddd3" stroke="#c8c3b8" strokeWidth="1.5" />
          <path className="pet-ear pet-ear-right" d="M65 26 L82 10 Q86 7 85 14 L84 35" fill="#e2ddd3" stroke="#c8c3b8" strokeWidth="1.5" />
          <path d="M38 24 L37 15 L47 26 M72 26 L81 15 L81 29" stroke="#c99d91" strokeWidth="4" strokeLinecap="round" />
          <rect x="32" y="22" width="56" height="40" rx="19" fill="url(#petBody)" />
          <path d="M44 26 q5 -5 9 -1 M66 24 q5 -3 10 2" stroke="#b2ada3" strokeWidth="3" fill="none" strokeLinecap="round" />
          {state === "ready" ? <g fill="none" stroke="#303035" strokeWidth="2.5" strokeLinecap="round"><path d="M44 40 q4 -6 8 0 M68 40 q4 -6 8 0" /></g> : <g className="pet-gaze" fill="#303035">
            <ellipse className="pet-eye" cx="48" cy="39" rx="3.5" ry={state === "blocked" ? 2 : 4.5} />
            <ellipse className="pet-eye" cx="72" cy="39" rx="3.5" ry={state === "blocked" ? 2 : 4.5} />
          </g>}
          <path d="M57 46 Q60 44 63 46 L60 49 Z" fill="#a57970" />
          <path d="M60 49 q-3 5 -6 1 M60 49 q3 5 6 1" stroke="#615954" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M42 46 l-16 -3 M42 50 l-15 3 M78 46 l16 -3 M78 50 l15 3" stroke="#b4afa5" strokeWidth="1.3" strokeLinecap="round" />
        </g>
        <path d="M44 59 Q60 66 77 59" fill="none" stroke={face.fill} strokeWidth="4" strokeLinecap="round" />
        <rect x="56" y="62" width="8" height="13" rx="4" fill={face.ring} stroke="#494444" strokeWidth=".8" />
      </g>
      {count > 1 ? (
        <g>
          <circle cx="99" cy="20" r="10" fill="#1c1c20" stroke={face.ring} strokeWidth="1.5" />
          <text x="99" y="24" textAnchor="middle" fontSize="11" fontWeight="600" fill="#f2f2f2">
            {count > 9 ? "9+" : count}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

const STATE_WORD: Record<AttentionState, string> = {
  "needs-input": "Needs you",
  blocked: "Stopped",
  ready: "Ready",
  running: "Working",
};

export function Pet() {
  const api = window.capsule;
  const [summary, setSummary] = useState<AttentionSummary>();
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(() => readPreference("capsule.pet.paused") === "true");
  const [large, setLarge] = useState(() => readPreference("capsule.pet.large") !== "false");
  const [greeting, setGreeting] = useState(false);
  const [play, setPlay] = useState<"pounce" | "stretch">();
  const [retry, setRetry] = useState(0);
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

  return (
    <div className={`pet pet--${state}${open ? " pet--open" : ""}${paused ? " pet--paused" : ""}${large ? " pet--large" : ""}${greeting ? " pet--greeting" : ""}${play ? ` pet--${play}` : ""}`} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); bodyRef.current?.focus(); } }}>
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
            <button type="button" onClick={() => { clearTimeout(greetingTimer.current); setGreeting(false); setPlay("pounce"); greetingTimer.current = setTimeout(() => setPlay(undefined), 1800); }}>Play</button>
            <button type="button" onClick={() => { clearTimeout(greetingTimer.current); setGreeting(false); setPlay("stretch"); greetingTimer.current = setTimeout(() => setPlay(undefined), 2200); }}>Stretch</button>
            <button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? "Resume motion" : "Pause motion"}</button>
            <button type="button" aria-pressed={large} onClick={() => setLarge((value) => !value)}>{large ? "Smaller" : "Larger"}</button>
            <button type="button" onClick={() => void api.togglePet(false).catch(() => setError(true))}>Hide companion</button>
          </div>
          <p className="pet-tray-empty">Restore from Settings → General or the command palette.</p>
        </div>
      ) : null}

      <div className="pet-stage">
      <div className="pet-handle" title="Drag to move companion" aria-hidden>⠿</div>
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
          event.currentTarget.style.setProperty("--pet-look", `${Math.max(-2, Math.min(2, (event.clientX - rect.left - rect.width / 2) / 16))}px`);
        }}
        onPointerLeave={(event) => event.currentTarget.style.setProperty("--pet-look", "0px")}
        onClick={() => setOpen((value) => !value)}
      >
        <Capsule state={state} count={error ? 0 : summary?.items.length ?? 0} />
      </button>
      <button className="pet-wave" type="button" aria-label="Wave to companion" onClick={() => { clearTimeout(greetingTimer.current); setPlay(undefined); setGreeting(true); greetingTimer.current = setTimeout(() => setGreeting(false), 1600); }}>Wave</button>
      </div>
      <div className="pet-caption" role="status">{label}{greeting ? " · Hello!" : play === "pounce" ? " · Playing" : play === "stretch" ? " · Stretching" : ""}</div>
    </div>
  );
}

function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
