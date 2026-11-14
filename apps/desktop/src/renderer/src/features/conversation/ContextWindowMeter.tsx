import { useState, useRef, useEffect } from "react";
import { formatTokens } from "../../lib/context-window";

interface ContextWindowMeterProps {
  used: number;
  limit: number;
  fraction: number;
  tone?: "normal" | "warn" | "critical";
  size?: number;
  /** Ask the agent to compact its context; absent when the agent offers no such command. */
  onCompact?: () => void;
  /** Why compacting is unavailable, said instead of hiding the control. */
  compactUnavailable?: string;
  /** Minutes since the conversation last moved; past five the prompt cache has likely expired. */
  idleMinutes?: number;
  /** Start a new conversation in this project. */
  onFresh?: () => void;
  /** Continue this thread in a new one with a summary; absent where that is unavailable. */
  onHandoff?: () => void;
}

export function ContextWindowMeter({
  used,
  limit,
  fraction,
  tone = "normal",
  size = 20,
  onCompact,
  compactUnavailable,
  idleMinutes,
  onFresh,
  onHandoff,
}: ContextWindowMeterProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  const offset = circumference - clamped * circumference;
  const pct = (clamped * 100).toFixed(1);

  /*
   * The caller decides this. Re-deriving it here from different thresholds
   * meant a reading the caller called normal could still paint amber, and
   * --amber is not a token this app defines, so the fallback hex bypassed the
   * theme entirely.
   */
  const stroke =
    tone === "critical" ? "var(--red)" : tone === "warn" ? "var(--yellow)" : "var(--text-muted)";

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const usedLabel = formatTokens(used).toLowerCase();
  const limitLabel = formatTokens(limit).toLowerCase();

  return (
    <div className="context-meter-wrapper" ref={wrapperRef}>
      {/* Ring button */}
      <button
        type="button"
        className={`context-meter-ring${open ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={`Context: ${pct}% · ${usedLabel}/${limitLabel}`}
        aria-expanded={open}
        aria-label="Context window"
        style={{ width: size + 4, height: size + 4 }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border-color)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dashoffset 0.25s ease, stroke 0.25s ease" }}
          />
        </svg>
      </button>

      {/* Popover card */}
      {open && (
        <div className="context-card" role="dialog" aria-label="Context window">
          <div className="context-card-row">
            <span className="context-card-title">Context window</span>
            <span className="context-card-stat mono">{pct}% · {usedLabel}/{limitLabel}</span>
          </div>

          <div className="context-card-track" aria-hidden>
            <div
              className="context-card-fill"
              style={{ width: `${Math.max(2, clamped * 100)}%`, background: stroke }}
            />
          </div>
          {idleMinutes !== undefined && idleMinutes >= 5 && (
            <p className="context-card-hint">Idle {Math.round(idleMinutes)} min. The prompt cache has likely expired, so compacting now costs the least.</p>
          )}
          {tone !== "normal" && (
            <p className="context-card-hint">
              {tone === "critical" ? "Almost full." : "Filling up."} Compact to keep going on this task. For something unrelated, a new conversation starts with a clean context and does better.
            </p>
          )}
          <div className="context-card-actions">
            {onFresh && tone !== "normal" ? <button type="button" className="chip" onClick={() => { setOpen(false); onFresh(); }}>New conversation</button> : null}
            <button type="button" className="chip" disabled={!onCompact} title={onCompact ? "Ask the agent to summarize its context into less" : compactUnavailable} onClick={() => { onCompact?.(); setOpen(false); }}>Compact conversation</button>
            {onHandoff && <button type="button" className="chip" title="Start a new conversation from a summary of this one, on this agent or another" onClick={() => { setOpen(false); onHandoff(); }}>Hand off to a new conversation…</button>}
            {!onCompact && compactUnavailable && <span className="faint">{compactUnavailable}</span>}
          </div>

        </div>
      )}
    </div>
  );
}
