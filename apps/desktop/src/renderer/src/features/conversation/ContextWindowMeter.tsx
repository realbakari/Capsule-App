import { useState, useRef, useEffect } from "react";
import { formatTokens } from "../../lib/context-window";
import { MinimizeIcon } from "../shell/icons";

interface ContextWindowMeterProps {
  used: number;
  limit: number;
  fraction: number;
  tone?: "normal" | "warn" | "critical";
  size?: number;
  onCompact?: () => void;
}

export function ContextWindowMeter({
  used,
  limit,
  fraction,
  tone = "normal",
  size = 20,
  onCompact,
}: ContextWindowMeterProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction));
  const offset = circumference - clamped * circumference;
  const pct = (clamped * 100).toFixed(1);

  const stroke =
    tone === "critical" || clamped > 0.85
      ? "var(--red, #ff453a)"
      : tone === "warn" || clamped > 0.65
        ? "var(--amber, #ff9f0a)"
        : "var(--text-muted)";

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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
            stroke="rgba(255,255,255,0.1)"
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
            <span className="context-card-title">Context Window</span>
            <span className="context-card-stat mono">{pct}% · {usedLabel}/{limitLabel}</span>
          </div>

          <div className="context-card-track" aria-hidden>
            <div
              className="context-card-fill"
              style={{ width: `${Math.max(2, clamped * 100)}%`, background: stroke }}
            />
          </div>

          {onCompact && (
            <button type="button" className="context-card-action" onClick={() => { setOpen(false); onCompact(); }}>
              <MinimizeIcon size={13} />
              <span>Compact context</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
