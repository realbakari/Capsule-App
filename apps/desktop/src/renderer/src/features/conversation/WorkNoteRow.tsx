import { useState } from "react";
import type { WorkNote } from "../../lib/turn-timeline";
import { ChevronRightIcon, MessageSquareIcon, ShieldCheckIcon, ShieldOffIcon, SparkIcon } from "../shell/icons";
import { CompactionDivider } from "./CompactionDivider";
import { MarkdownBody } from "./MarkdownBody";

const DECISION_LABEL: Record<Extract<WorkNote, { kind: "decision" }>["outcome"], string> = {
  allowed: "Allowed",
  "allowed-session": "Allowed for this conversation",
  denied: "Denied",
  unanswered: "Not answered",
  answered: "Answered",
};

/** The first line of a thought, as the closed row's preview. */
function preview(text: string): string {
  return text.trim().split("\n").find((line) => line.trim())?.replace(/[*_`#>]/gu, "").trim().slice(0, 140) ?? "";
}

/** One quiet row in the work log: a thought, a person's decision, or a compaction. */
export function WorkNoteRow({ note }: { note: WorkNote }) {
  const [open, setOpen] = useState(false);
  if (note.kind === "compaction") return <CompactionDivider note={note} />;
  if (note.kind === "decision") {
    const Icon = note.outcome === "answered" || note.outcome === "unanswered" ? MessageSquareIcon : note.outcome === "denied" ? ShieldOffIcon : ShieldCheckIcon;
    return <div className="work-note work-note-decision" data-outcome={note.outcome}>
      <Icon size={14} aria-hidden />
      <span className="work-note-label">{DECISION_LABEL[note.outcome]}{note.outcome === "unanswered" ? "" : ":"}</span>
      {note.outcome === "unanswered" ? null : <span className="work-note-subject" title={note.detail ?? note.subject}>
        {note.subject}{note.detail && note.outcome !== "answered" ? <span className="mono work-note-detail"> {note.detail}</span> : null}
      </span>}
    </div>;
  }
  return <div className="work-note work-note-reasoning">
    <button type="button" className="work-note-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <SparkIcon size={14} aria-hidden />
      <span className="work-note-label">Thought</span>
      {!open && <span className="work-note-subject">{preview(note.text)}</span>}
      <ChevronRightIcon size={12} className={open ? "open" : ""} aria-hidden />
    </button>
    {/* Mounted only when opened: a long turn can carry many thoughts nobody reads. */}
    {open && <div className="work-note-body"><MarkdownBody content={note.text.trim()} /></div>}
  </div>;
}
