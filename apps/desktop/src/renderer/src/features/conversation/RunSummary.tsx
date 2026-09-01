import { useState } from "react";
import { ChevronDownIcon, TerminalIcon, CheckIcon } from "../shell/icons";

interface RunSummaryProps {
  /** Pre-computed by summariseWork, which owns the counting rules. */
  label: string;
  duration?: string;
  isComplete?: boolean;
  children?: React.ReactNode;
}

export function RunSummary({ label, duration, isComplete = true, children }: RunSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  if (!label && !duration) return null;

  return (
    <div className={`run-summary-card ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="run-summary-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="run-summary-lead">
          <TerminalIcon size={13} className="run-summary-icon" />
          <span className="run-summary-label">{label}</span>
          {duration && <span className="run-summary-duration">· {duration}</span>}
          {isComplete && (
            <span className="run-summary-done-badge">
              <CheckIcon size={11} />
            </span>
          )}
        </span>
        <span className={`run-summary-chevron ${expanded ? "open" : ""}`}>
          <ChevronDownIcon size={13} />
        </span>
      </button>

      {expanded && children && (
        <div className="run-summary-body">
          {children}
        </div>
      )}
    </div>
  );
}
