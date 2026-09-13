import { useState } from "react";
import type { Run } from "@capsule/shared";
import { toolGroupLabel, toolObservationState, type ToolObservation } from "../../lib/turn-timeline";
import { ChevronRightIcon, TerminalIcon, WrenchIcon } from "../shell/icons";

/** Compact observed work, never a claim that the turn was verified. */
export function InlineActivity({ tools, run, stopping }: { tools: ToolObservation[]; run: Run; stopping?: boolean }) {
  const [open, setOpen] = useState(false);
  const failed = tools.some((tool) => tool.status === "failed");
  const pending = [...tools].reverse().find((tool) => tool.status !== "completed" && tool.status !== "failed");
  const state = failed ? "Failed" : pending ? toolObservationState(pending, run, stopping) : "Completed";
  const Icon = tools.every((tool) => tool.command) ? TerminalIcon : WrenchIcon;
  return <div className="inline-activity" data-state={state}>
    <button type="button" className="inline-activity-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Icon size={14} aria-hidden />
      <span>{toolGroupLabel(tools)}</span>
      <span className="inline-activity-state">{state}</span>
      <ChevronRightIcon size={12} className={open ? "open" : ""} aria-hidden />
    </button>
    {open && <ul className="inline-activity-tools">{tools.map((tool) => <li key={tool.id}>
      <span title={tool.title}>{tool.title}</span>
      <span className="inline-activity-state">{toolObservationState(tool, run, stopping)}</span>
    </li>)}</ul>}
  </div>;
}
