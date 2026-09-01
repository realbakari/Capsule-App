import { useState } from "react";
import { ChevronDownIcon, TerminalIcon, CheckIcon } from "../shell/icons";

interface RunSummaryProps {
  toolCount: number;
  commandCount?: number;
  duration?: string;
  isComplete?: boolean;
  children?: React.ReactNode;
}

export function RunSummary({
  toolCount,
  commandCount = 0,
  duration,
  isComplete = true,
  children,
}: RunSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  const totalActions = toolCount + commandCount;
  if (totalActions === 0 && !duration) return null;

  const label =
    commandCount > 0 && toolCount > 0
      ? `Ran ${commandCount} command${commandCount === 1 ? "" : "s"} and used ${toolCount} tool${toolCount === 1 ? "" : "s"}`
      : toolCount > 0
        ? `Used ${toolCount} tool${toolCount === 1 ? "" : "s"}`
        : `Ran ${commandCount} command${commandCount === 1 ? "" : "s"}`;

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
