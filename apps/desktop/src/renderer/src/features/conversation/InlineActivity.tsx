import { useState, type ComponentType, type SVGProps } from "react";
import type { Run } from "@capsule/shared";
import { toolGroupLabel, toolKindOrder, toolObservationState, type ToolKind, type ToolObservation } from "../../lib/turn-timeline";
import {
  ChevronRightIcon,
  DiffIcon,
  FileIcon,
  GlobeIcon,
  ListTodoIcon,
  SearchIcon,
  SparkIcon,
  TerminalIcon,
  TrashIcon,
  WrenchIcon,
} from "../shell/icons";

type Glyph = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const KIND_ICON: Record<ToolKind, Glyph> = {
  read: FileIcon,
  edit: DiffIcon,
  delete: TrashIcon,
  search: SearchIcon,
  execute: TerminalIcon,
  think: SparkIcon,
  fetch: GlobeIcon,
  todo: ListTodoIcon,
  other: WrenchIcon,
};

function ToolKindIcon({ kind, size = 14 }: { kind: ToolKind; size?: number }) {
  const Icon = KIND_ICON[kind];
  return <Icon size={size} data-kind={kind} />;
}

/** Compact observed work, never a claim that the turn was verified. */
export function InlineActivity({ tools, run, stopping }: { tools: ToolObservation[]; run: Run; stopping?: boolean }) {
  const [open, setOpen] = useState(false);
  const failed = tools.some((tool) => tool.status === "failed");
  const pending = [...tools].reverse().find((tool) => tool.status !== "completed" && tool.status !== "failed");
  const state = failed ? "Failed" : pending ? toolObservationState(pending, run, stopping) : "Completed";
  const kinds = toolKindOrder(tools);
  return <div className="inline-activity" data-state={state}>
    <button type="button" className="inline-activity-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="inline-activity-kinds" aria-hidden>
        {kinds.slice(0, 3).map((kind) => <ToolKindIcon key={kind} kind={kind} />)}
      </span>
      <span>{toolGroupLabel(tools)}</span>
      <span className="inline-activity-state">{state}</span>
      <ChevronRightIcon size={12} className={open ? "open" : ""} aria-hidden />
    </button>
    {open && <ul className="inline-activity-tools">{tools.map((tool) => <li key={tool.id}>
      <ToolKindIcon kind={tool.kind} size={13} />
      <span title={tool.title}>{tool.title}</span>
      <span className="inline-activity-state">{toolObservationState(tool, run, stopping)}</span>
    </li>)}</ul>}
  </div>;
}
