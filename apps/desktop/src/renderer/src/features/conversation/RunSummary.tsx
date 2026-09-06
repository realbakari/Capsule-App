import { useState } from "react";
import type { TouchedFile } from "../../lib/activity";
import { ChevronDownIcon, TerminalIcon } from "../shell/icons";
import { runActivityLabel, type Run } from "@capsule/shared";

interface RunSummaryProps {
  /** Pre-computed by summariseWork, which owns the counting rules. */
  label: string;
  duration?: string;
  run?: Run;
  stopping?: boolean;
  touchedFiles?: TouchedFile[];
  onOpenFile?: (path: string) => void;
  children?: React.ReactNode;
}

export function RunSummary({
  label,
  duration,
  run,
  stopping,
  touchedFiles,
  onOpenFile,
  children,
}: RunSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const [visited, setVisited] = useState(false);

  if (!run && !label && !duration && (!touchedFiles || touchedFiles.length === 0)) return null;

  return (
    <div className={`run-summary-card ${expanded ? "expanded" : ""}`} data-run-summary={run?.id}>
      <button
        type="button"
        className="run-summary-header"
        onClick={() => { setVisited(true); setExpanded((prev) => !prev); }}
        aria-expanded={expanded}
      >
        <span className="run-summary-lead">
          <TerminalIcon size={13} className="run-summary-icon" />
          <span className="run-summary-label">{label || "Turn details"}</span>
          {duration && <span className="run-summary-duration">· {duration}</span>}
          <span className="run-activity-state" data-state={run?.status} title={run?.verification?.summary}>{runActivityLabel(run, stopping)}</span>
        </span>
        <span className={`run-summary-chevron ${expanded ? "open" : ""}`}>
          <ChevronDownIcon size={13} />
        </span>
      </button>
          {touchedFiles && touchedFiles.length > 0 && (
            <div className="run-summary-chips-inline" aria-label="Files touched in this turn">
              {touchedFiles.slice(0, 3).map((file) => {
                const symbol = file.action === "created" ? "+" : file.action === "deleted" ? "−" : "~";
                const name = file.path.split(/[/\\]/).pop() ?? file.path;
                return (
                  <button
                    type="button"
                    key={file.path}
                    className={`run-summary-file-chip ${file.action}`}
                    disabled={!onOpenFile}
                    onClick={() => onOpenFile?.(file.path)}
                    title={`${file.path} (${file.action})`}
                    aria-label={`Open ${file.path}`}
                  >
                    <span className={`file-chip-action ${file.action}`}>{symbol}</span>
                    <span className="file-chip-name">{name}</span>
                    {typeof file.added === "number" && (
                      <span className="file-chip-stat">+{file.added}</span>
                    )}
                    {typeof file.removed === "number" && file.removed > 0 && (
                      <span className="file-chip-stat-del">−{file.removed}</span>
                    )}
                  </button>
                );
              })}
              {touchedFiles.length > 3 && (
                <span className="run-summary-more-chip">+{touchedFiles.length - 3} more</span>
              )}
            </div>
          )}

      {visited && children && (
        <div className="run-summary-body" hidden={!expanded}>
          {children}
        </div>
      )}
    </div>
  );
}
