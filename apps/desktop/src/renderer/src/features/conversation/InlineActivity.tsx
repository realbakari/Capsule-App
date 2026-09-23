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
import { CopyButton } from "./CopyButton";

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
export function InlineActivity({ tools, run, stopping, onOpenFile }: { tools: ToolObservation[]; run: Run; stopping?: boolean; onOpenFile?: (path: string) => void }) {
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
      <ToolStep tool={tool} state={toolObservationState(tool, run, stopping)} onOpenFile={onOpenFile} />
    </li>)}</ul>}
  </div>;
}

function ToolStep({ tool, state, onOpenFile }: { tool: ToolObservation; state: string; onOpenFile?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const details = tool.details;
  const hasDetails = details?.input || details?.output || details?.locations?.length;
  return <div className="activity-step" data-state={state}>
    <button type="button" className="activity-step-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <ToolKindIcon kind={tool.kind} size={14} />
      <span className="activity-step-title" title={tool.title}>{tool.title}</span>
      <span className="inline-activity-state">{state}</span>
      <ChevronRightIcon size={12} className={open ? "open" : ""} aria-hidden />
    </button>
    {open && <div className="activity-step-body">
      {details?.input && <ToolText label={tool.command ? "Command" : "Input"} text={details.input} />}
      {details?.output && <ToolText label="Output" text={details.output} />}
      {details?.locations?.length ? <div className="activity-step-files" aria-label="Reported files">{details.locations.map((path, index) =>
        onOpenFile ? <button type="button" className="activity-file" key={`${index}:${path}`} title={path} onClick={() => onOpenFile(path)}><FileIcon size={13} />{path}</button>
          : <span key={`${index}:${path}`}>{path}</span>)}</div> : null}
      {!hasDetails && <p className="muted">No additional details were reported for this step.</p>}
      {details?.truncated && <p className="muted">Preview shortened. Only the displayed text is copied.</p>}
    </div>}
  </div>;
}

function ToolText({ label, text }: { label: string; text: string }) {
  return <div className="activity-tool-text">
    <div className="activity-tool-text-heading"><span>{label}</span><CopyButton text={text} label={`Copy ${label.toLowerCase()} preview`} /></div>
    <pre tabIndex={0} aria-label={`${label} preview`}>{text}</pre>
  </div>;
}
