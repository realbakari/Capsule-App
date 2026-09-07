import { useId } from "react";
import type { AttentionState } from "@capsule/shared";

export type CompanionState = AttentionState | "idle";

const STATUS_COLOR: Record<CompanionState, string> = {
  idle: "#bdbdb6",
  running: "#bdbdb6",
  ready: "#9ac490",
  "needs-input": "#dfc481",
  blocked: "#d99393",
};

/** A two-piece capsule, not an animal or an emoji. Motion stays in CSS. */
export function CapsuleMascot({ state }: { state: CompanionState }) {
  const id = useId();
  const top = `${id}-top`;
  const bottom = `${id}-bottom`;
  return (
    <svg viewBox="0 0 160 144" className="pet-capsule" aria-hidden="true">
      <defs>
        <linearGradient id={top} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fffff8" />
          <stop offset="1" stopColor="#c4c4ba" />
        </linearGradient>
        <linearGradient id={bottom} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#484849" />
          <stop offset="1" stopColor="#1d1d20" />
        </linearGradient>
      </defs>
      <ellipse className="capsule-shadow" cx="80" cy="132" rx="30" ry="4" fill="#000" opacity=".25" />
      <g className="capsule-motion">
        <g transform="rotate(-16 80 70)">
          <path className="capsule-shell-top" d="M48 68V46a32 32 0 0 1 64 0v22Z" fill={`url(#${top})`} />
          <path className="capsule-shell-bottom" d="M48 72h64v22a32 32 0 0 1-64 0Z" fill={`url(#${bottom})`} stroke="#777773" strokeWidth=".8" />
          <path d="M55 42a25 25 0 0 1 24-21" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" />
          <path className="capsule-seam" d="M49 70h62" fill="none" stroke={STATUS_COLOR[state]} strokeWidth="2" strokeLinecap="round" />
          <g className="capsule-gaze" fill="#303033">
            <g className="capsule-eyes">
              {state === "ready" ? <path d="M63 45q4-6 8 0m18 0q4-6 8 0" fill="none" stroke="#303033" strokeWidth="3" strokeLinecap="round" /> : <>
                <rect x="64" y="39" width="6" height={state === "blocked" ? 3 : 10} rx="3" />
                <rect x="90" y="39" width="6" height={state === "blocked" ? 3 : 10} rx="3" />
              </>}
            </g>
            <path d={state === "blocked" ? "M76 57h8" : "M76 55q4 4 8 0"} fill="none" stroke="#52524e" strokeWidth="2" strokeLinecap="round" />
          </g>
          <circle cx="80" cy="96" r="12" fill="#1a1a1d" stroke="#5c5c59" />
          <g className="capsule-core" fill="none" stroke={STATUS_COLOR[state]} strokeWidth="2" strokeLinecap="round">
            {state === "ready" ? <path d="m74 96 4 4 8-8" />
              : state === "blocked" ? <path d="m76 92 8 8m0-8-8 8" />
                : state === "needs-input" ? <path d="M80 90v7m0 4v.1" />
                  : <path d="M80 88a8 8 0 0 1 8 8m-8 8a8 8 0 0 1-8-8" />}
          </g>
          <path d="M59 101a23 23 0 0 0 16 17" fill="none" stroke="#777773" strokeOpacity=".4" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}
