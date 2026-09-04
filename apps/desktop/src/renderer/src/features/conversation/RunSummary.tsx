import { useState } from "react";
import type { TouchedFile } from "../../lib/activity";
import { ChevronDownIcon, TerminalIcon, CheckIcon } from "../shell/icons";

interface RunSummaryProps {
  /** Pre-computed by summariseWork, which owns the counting rules. */
  label: string;
  duration?: string;
  isComplete?: boolean;
  touchedFiles?: TouchedFile[];
  onOpenFile?: (path: string) => void;
  children?: React.ReactNode;
}

export function RunSummary({
  label,
  duration,
  isComplete = true,
  touchedFiles,
  onOpenFile,
  children,
}: RunSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  if (!label && !duration && (!touchedFiles || touchedFiles.length === 0)) return null;

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
            <span className="run-summary-done-badge" title="Activity finished — not a verification result">
              <CheckIcon size={11} />
            </span>
          )}
        </span>

        <span className="run-summary-meta">
          {touchedFiles && touchedFiles.length > 0 && (
            <span className="run-summary-chips-inline">
              {touchedFiles.slice(0, 3).map((file) => {
                const symbol = file.action === "created" ? "+" : file.action === "deleted" ? "−" : "~";
                const name = file.path.split(/[/\\]/).pop() ?? file.path;
                return (
                  <span
                    key={file.path}
                    className={`run-summary-file-chip ${file.action}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenFile?.(file.path);
                    }}
                    title={`${file.path} (${file.action}) — Click to view`}
                  >
                    <span className={`file-chip-action ${file.action}`}>{symbol}</span>
                    <span className="file-chip-name">{name}</span>
                    {typeof file.added === "number" && (
                      <span className="file-chip-stat">+{file.added}</span>
                    )}
                    {typeof file.removed === "number" && file.removed > 0 && (
                      <span className="file-chip-stat-del">−{file.removed}</span>
                    )}
                  </span>
                );
              })}
              {touchedFiles.length > 3 && (
                <span className="run-summary-more-chip">+{touchedFiles.length - 3} more</span>
              )}
            </span>
          )}
          <span className={`run-summary-chevron ${expanded ? "open" : ""}`}>
            <ChevronDownIcon size={13} />
          </span>
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
