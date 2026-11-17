import { useId, type CSSProperties, type Ref } from "react";
import type { CompanionState, Mood } from "./behavior";

export type { CompanionState } from "./behavior";

/*
 * Each face part is one path whose command structure never changes between
 * moods, so CSS can morph it (`d` transitions) instead of swapping shapes.
 * An eye is a closed curve: top contour `t` above the centre, bottom contour
 * `b` below it. A negative `b` lifts the lower lid into a smiling crescent.
 */
const K = 0.5523;
function eye(cx: number, cy: number, w: number, t: number, b: number): string {
  const f = (n: number) => +n.toFixed(2);
  return `M${f(cx - w)} ${cy}C${f(cx - w)} ${f(cy - K * t)} ${f(cx - K * w)} ${f(cy - t)} ${cx} ${f(cy - t)}C${f(cx + K * w)} ${f(cy - t)} ${f(cx + w)} ${f(cy - K * t)} ${f(cx + w)} ${cy}`
    + `C${f(cx + w)} ${f(cy + K * b)} ${f(cx + K * w)} ${f(cy + b)} ${cx} ${f(cy + b)}C${f(cx - K * w)} ${f(cy + b)} ${f(cx - w)} ${f(cy + K * b)} ${f(cx - w)} ${cy}Z`;
}
/** A mouth: left and right corners joined by an upper and a lower curve. */
const mouth = (y: number, half: number, top: number, bottom: number) => `M${80 - half} ${y}Q80 ${top} ${80 + half} ${y}Q80 ${bottom} ${80 - half} ${y}Z`;
/** Both brows, each one quadratic stroke. */
const brows = (l: [number, number, number, number, number, number], r: [number, number, number, number, number, number]) => `M${l[0]} ${l[1]}Q${l[2]} ${l[3]} ${l[4]} ${l[5]}M${r[0]} ${r[1]}Q${r[2]} ${r[3]} ${r[4]} ${r[5]}`;
const LEVEL = brows([61, 35, 67, 33, 73, 35], [87, 35, 93, 33, 99, 35]);

type Face = { eye: [number, number, number]; mouth: string; brows: string; browsShown: boolean; shine: boolean };
const FACE: Record<Mood, Face> = {
  calm: { eye: [5.2, 6.6, 6.6], mouth: mouth(58.5, 4.5, 61, 63.5), brows: LEVEL, browsShown: false, shine: true },
  focused: { eye: [5.2, 4.4, 5.8], mouth: mouth(60, 3.5, 60.4, 61.2), brows: brows([61.5, 34.5, 67, 35, 72.5, 37.5], [87.5, 37.5, 93, 35, 98.5, 34.5]), browsShown: true, shine: true },
  happy: { eye: [6, 5.6, -2.4], mouth: mouth(57.5, 6, 59.5, 66), brows: LEVEL, browsShown: false, shine: false },
  curious: { eye: [5.6, 7.6, 7], mouth: mouth(60, 2.6, 56.2, 63.6), brows: brows([61, 33, 67, 28.5, 73, 32], [87, 32, 93, 28.5, 99, 33]), browsShown: true, shine: true },
  worried: { eye: [4.8, 5, 5.8], mouth: mouth(61.5, 4.5, 57.8, 59.2), brows: brows([61.5, 36.5, 67, 35.2, 72.5, 32.8], [87.5, 32.8, 93, 35.2, 98.5, 36.5]), browsShown: true, shine: true },
  beaming: { eye: [6, 5.8, -2.6], mouth: mouth(57, 6.5, 59, 67), brows: LEVEL, browsShown: false, shine: false },
  sleepy: { eye: [6, -0.8, 2.8], mouth: mouth(60, 3, 60.2, 61.2), brows: LEVEL, browsShown: false, shine: false },
  yawning: { eye: [6, -0.6, 2.8], mouth: mouth(60, 4, 53.5, 67), brows: LEVEL, browsShown: false, shine: false },
};

const SILHOUETTE = "M48 48A32 32 0 0 1 112 48V94A32 32 0 0 1 48 94Z";

/** The core's glyph names the state without colour or motion. */
function Glyph({ state }: { state: CompanionState }) {
  switch (state) {
    case "ready": return <path className="capsule-glyph capsule-glyph--check" pathLength={1} d="m74.5 99.5 3.8 3.8 7.4-7.6" />;
    case "blocked": return <path className="capsule-glyph" d="m76 95 8 8m0-8-8 8" />;
    case "needs-input": return <path className="capsule-glyph" d="M80 93.5v6.2m0 3.6v.1" />;
    case "running": return <path className="capsule-glyph capsule-glyph--spin" d="M80 91.5a7.5 7.5 0 1 1-7.5 7.5" />;
    default: return <circle className="capsule-glyph capsule-glyph--dot" cx="80" cy="99" r="2" />;
  }
}

function Arm({ side, gradient }: { side: "left" | "right"; gradient: string }) {
  return (
    <g transform={side === "left" ? "translate(50.5 76)" : "translate(109.5 76)"}>
      <g className={`capsule-arm capsule-arm--${side}`}>
        <g className="capsule-arm-play">
          <g className="capsule-arm-idle">
            <rect x="-5.5" y="-3" width="11" height="23" rx="5.5" fill={`url(#${gradient})`} className="capsule-limb" />
          </g>
        </g>
      </g>
    </g>
  );
}

/**
 * The companion: a two-tone capsule with articulated arms and a morphing face.
 * Every moving part sits in its own group so idle life, state poses and
 * gestures compose instead of replacing one another.
 */
export function CapsuleMascot({ state, mood, shiftRef }: { state: CompanionState; mood: Mood; shiftRef?: Ref<SVGGElement> }) {
  const id = useId().replace(/:/g, "");
  const shell = `${id}-shell`;
  const graphite = `${id}-graphite`;
  const limb = `${id}-limb`;
  const ground = `${id}-ground`;
  const clip = `${id}-clip`;
  const face = FACE[mood];
  const [w, t, b] = face.eye;
  const morph = (d: string): { d: string; style: CSSProperties } => ({ d, style: { d: `path("${d}")` } as CSSProperties });
  return (
    <svg viewBox="0 0 160 144" className="pet-capsule" aria-hidden="true" data-mood={mood}>
      <defs>
        <linearGradient id={shell} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="pet-stop-shell-lo" />
          <stop offset=".18" className="pet-stop-shell-hi" />
          <stop offset=".62" className="pet-stop-shell" />
          <stop offset="1" className="pet-stop-shell-lo" />
        </linearGradient>
        <linearGradient id={limb} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="pet-stop-shell-hi" />
          <stop offset="1" className="pet-stop-shell-lo" />
        </linearGradient>
        <linearGradient id={graphite} x1="0" y1="0" x2=".35" y2="1">
          <stop offset="0" className="pet-stop-graphite-hi" />
          <stop offset=".55" className="pet-stop-graphite" />
          <stop offset="1" className="pet-stop-graphite-lo" />
        </linearGradient>
        <radialGradient id={ground}>
          <stop offset="0" className="pet-stop-ground" />
          <stop offset="1" className="pet-stop-ground" stopOpacity="0" />
        </radialGradient>
        <clipPath id={clip}><path d={SILHOUETTE} /></clipPath>
      </defs>
      <g className="capsule-shadow-reaction">
        <ellipse className="capsule-shadow" cx="80" cy="132" rx="30" ry="5" fill={`url(#${ground})`} />
      </g>
      <g className="capsule-place">
        <g className="capsule-shift" ref={shiftRef}>
          <g className="capsule-reaction">
            <g className="capsule-motion">
              <g className="capsule-breathe">
                <Arm side="left" gradient={limb} />
                <Arm side="right" gradient={limb} />
                <path className="capsule-shell-top" d="M48 70V48A32 32 0 0 1 112 48V70Z" fill={`url(#${shell})`} />
                <path className="capsule-shell-bottom" d="M48 70H112V94A32 32 0 0 1 48 94Z" fill={`url(#${graphite})`} />
                <g clipPath={`url(#${clip})`}>
                  <rect className="capsule-seam" x="48" y="68" width="64" height="4.5" />
                  <rect className="capsule-scan" x="32" y="68" width="14" height="4.5" />
                </g>
                <path className="capsule-shine" d="M55.5 45A25 25 0 0 1 69 25" />
                <path className="capsule-shine capsule-shine--low" d="M53.5 79V93A26.5 26.5 0 0 0 59 109" />
                <path className="capsule-outline" d={SILHOUETTE} />
                <g className="capsule-face">
                  <path className={`capsule-brows${face.browsShown ? "" : " is-hidden"}`} {...morph(face.brows)} />
                  <g className="capsule-eyes-look">
                    <g className="capsule-eyes">
                      <path className="capsule-eye" {...morph(eye(68, 46, w, t, b))} />
                      <path className="capsule-eye" {...morph(eye(92, 46, w, t, b))} />
                      <g className={`capsule-eye-light${face.shine ? "" : " is-hidden"}`}>
                        <circle cx="66.2" cy="43.2" r="1.7" /><circle cx="90.2" cy="43.2" r="1.7" />
                      </g>
                    </g>
                  </g>
                  <path className="capsule-mouth" {...morph(face.mouth)} />
                </g>
                <circle className="capsule-core-well" cx="80" cy="99" r="12" />
                <circle className="capsule-core-ring" cx="80" cy="99" r="12" />
                <g className="capsule-core" key={state}><Glyph state={state} /></g>
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
