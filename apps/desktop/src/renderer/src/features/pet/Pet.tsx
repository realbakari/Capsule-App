import { useCallback, useEffect, useMemo, useState } from "react";
import {
  attentionLabel,
  summariseAttention,
  type AttentionItem,
  type AttentionState,
  type Run,
  type Session,
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
 * It is a capsule, because that is what this app is. Drawn rather than
 * shipped as art: an SVG scales to any display, follows the theme, and costs
 * nothing to change.
 */

const FACES: Record<AttentionState | "idle", { fill: string; ring: string; mood: string }> = {
  // Amber, and looking straight at you: the only state where nothing moves
  // until a person acts.
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
    <svg viewBox="0 0 64 76" className={`pet-capsule pet-capsule--${state}`} aria-hidden>
      <defs>
        <linearGradient id="petBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={face.ring} />
          <stop offset="100%" stopColor={face.fill} />
        </linearGradient>
      </defs>

      {/* The body: a capsule, upright. */}
      <rect x="10" y="8" width="44" height="60" rx="22" fill="url(#petBody)" />
      {/* The seam every capsule has. */}
      <line x1="10" y1="38" x2="54" y2="38" stroke="rgb(0 0 0 / 0.18)" strokeWidth="1.5" />

      {state === "blocked" ? (
        <g stroke="#2b2b2f" strokeWidth="3" strokeLinecap="round">
          <line x1="21" y1="26" x2="28" y2="33" />
          <line x1="28" y1="26" x2="21" y2="33" />
          <line x1="36" y1="26" x2="43" y2="33" />
          <line x1="43" y1="26" x2="36" y2="33" />
        </g>
      ) : state === "ready" ? (
        <g fill="none" stroke="#2b2b2f" strokeWidth="3" strokeLinecap="round">
          <path d="M20 30 q4.5 -6 9 0" />
          <path d="M35 30 q4.5 -6 9 0" />
        </g>
      ) : (
        <g fill="#2b2b2f">
          <circle className="pet-eye" cx="24.5" cy="29" r="4" />
          <circle className="pet-eye" cx="39.5" cy="29" r="4" />
        </g>
      )}

      {/* How many things are waiting, when more than one is. */}
      {count > 1 ? (
        <g>
          <circle cx="50" cy="14" r="10" fill="#1c1c20" stroke={face.ring} strokeWidth="1.5" />
          <text x="50" y="18" textAnchor="middle" fontSize="11" fontWeight="600" fill="#f2f2f2">
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
  const [sessions, setSessions] = useState<Session[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      const [nextSessions, nextRuns] = await Promise.all([api.listSessions(), api.listRuns()]);
      setSessions(nextSessions as Session[]);
      setRuns(nextRuns as Run[]);
    } catch {
      // A pet that throws is worse than one that is briefly stale.
    }
  }, [api]);

  useEffect(() => {
    void load();
    if (!api) return undefined;
    /*
     * Driven by the same events the main window sees, so the face changes when
     * the work does rather than on a timer.
     */
    const offRun = api.on("run", () => void load());
    const offApproval = api.on("approval", () => void load());
    return () => {
      offRun();
      offApproval();
    };
  }, [api, load]);

  /*
   * Shown only once it has drawn. The window is transparent, so revealing it
   * on the renderer's first frame showed an empty rectangle that then became
   * a capsule — the flicker. Two frames, the same wait the main window uses.
   */
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => void api?.rendererReady?.("pet")),
    );
    return () => cancelAnimationFrame(id);
  }, [api]);

  const summary = useMemo(() => summariseAttention({ sessions, runs }), [sessions, runs]);
  const state: AttentionState | "idle" = summary.state ?? "idle";
  const label = attentionLabel(summary) ?? "Nothing waiting";

  const openSession = (item: AttentionItem) => {
    void api?.focusSession?.(item.sessionId);
    setOpen(false);
  };

  return (
    <div className={`pet pet--${state}${open ? " pet--open" : ""}`}>
      {/*
        * The tray, above the capsule so the pet stays where it was put. It
        * lists what the menu bar lists, because they read the same summary.
        */}
      {open ? (
        <div className="pet-tray">
          <div className="pet-tray-head">{label}</div>
          {summary.items.length === 0 ? (
            <p className="pet-tray-empty">Every thread is settled.</p>
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
        </div>
      ) : null}

      <button
        type="button"
        className="pet-body"
        title={label}
        aria-label={`Capsule — ${label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Capsule state={state} count={summary.items.length} />
      </button>
    </div>
  );
}
