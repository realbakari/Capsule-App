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

/** Resolution-independent shell and articulated parts; each motion has its own pivot. */
export function CapsuleMascot({ state, greeting = false }: { state: CompanionState; greeting?: boolean }) {
  const id = useId();
  const top = `${id}-top`;
  const bottom = `${id}-bottom`;
  const eye = `${id}-eye`;
  const rim = `${id}-rim`;
  return (
    <svg viewBox="0 0 160 144" className="pet-capsule" aria-hidden="true">
      <defs>
        <linearGradient id={top} x1="0" y1=".2" x2="1" y2=".7">
          <stop stopColor="#b7b9b2" />
          <stop offset=".22" stopColor="#f8f9f1" />
          <stop offset=".55" stopColor="#eeefe7" />
          <stop offset="1" stopColor="#a4a79f" />
        </linearGradient>
        <linearGradient id={bottom} x1="0" y1="0" x2="1" y2=".4">
          <stop stopColor="#222629" />
          <stop offset=".28" stopColor="#505759" />
          <stop offset=".62" stopColor="#343a3d" />
          <stop offset="1" stopColor="#171b1e" />
        </linearGradient>
        <radialGradient id={eye} cx=".35" cy=".25" r=".8"><stop stopColor="#4f5b5f" /><stop offset="1" stopColor="#11171a" /></radialGradient>
        <linearGradient id={rim}><stop stopColor="#6f7978" /><stop offset=".4" stopColor="#d0d6cd" /><stop offset="1" stopColor="#434d4c" /></linearGradient>
      </defs>
      <ellipse className="capsule-shadow" cx="80" cy="132" rx="30" ry="4" fill="#000" opacity=".25" />
      <g className="capsule-motion">
        <g className="capsule-breathe">
          <g className="capsule-arm capsule-arm--left"><path d="M49 79c-13-4-22 6-18 14 4 8 11-1 17-5" fill={`url(#${top})`} stroke="#a4aaa3" strokeWidth=".6" /></g>
          <g className="capsule-arm capsule-arm--right"><path d="M110 79c13-4 22 6 18 14-4 8-11-1-17-5" fill={`url(#${top})`} stroke="#a4aaa3" strokeWidth=".6" /></g>
          <path className="capsule-shell-bottom" d="M48 69h64v25a32 32 0 0 1-64 0Z" fill={`url(#${bottom})`} stroke={`url(#${rim})`} strokeWidth=".9" />
          <path d="M53 78v16a27 27 0 0 0 18 25" fill="none" stroke="#cbd4cf" strokeOpacity=".17" strokeWidth="1.4" strokeLinecap="round" />
          <g className="capsule-head">
            <path className="capsule-shell-top" d="M48 68V46a32 32 0 0 1 64 0v22Z" fill={`url(#${top})`} stroke="#e7e9de" strokeOpacity=".45" strokeWidth=".7" />
            <path d="M55 41a25 25 0 0 1 25-21" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="2.5" strokeLinecap="round" />
            <path className="capsule-seam" d="M49 69h62" fill="none" stroke={STATUS_COLOR[state]} strokeWidth="2" strokeLinecap="round" />
            <g className="capsule-gaze">
              <g className="capsule-face">
                <g className="capsule-eyes">
                  <ellipse cx="67" cy="45" rx="6" ry={state === "blocked" ? 3 : 8} fill={`url(#${eye})`} />
                  <ellipse cx="93" cy="45" rx="6" ry={state === "blocked" ? 3 : 8} fill={`url(#${eye})`} />
                  <g className="capsule-eye-light" fill="#fff"><ellipse cx="65.5" cy="42.5" rx="1.7" ry="2" /><ellipse cx="91.5" cy="42.5" rx="1.7" ry="2" /></g>
                </g>
                <path className="capsule-mouth" d={state === "blocked" ? "M77 57h6" : greeting ? "M74 55q6 12 12 0Z" : "M76 56q4 4 8 0"} fill={greeting ? "#293237" : "none"} stroke="#37423f" strokeWidth="1.7" strokeLinecap="round" />
              </g>
            </g>
          </g>
          <circle cx="80" cy="96" r="11" fill="#20272b" stroke={`url(#${rim})`} strokeWidth=".7" />
          <g className="capsule-core" fill="none" stroke={STATUS_COLOR[state]} strokeWidth="2" strokeLinecap="round">
            {state === "ready" ? <path d="M76 96h8m-4-4v8" />
              : state === "blocked" ? <path d="m76 92 8 8m0-8-8 8" />
                : state === "needs-input" ? <path d="M80 90v7m0 4v.1" />
                  : <path d="M80 88a8 8 0 0 1 8 8m-8 8a8 8 0 0 1-8-8" />}
          </g>
        </g>
      </g>
    </svg>
  );
}
