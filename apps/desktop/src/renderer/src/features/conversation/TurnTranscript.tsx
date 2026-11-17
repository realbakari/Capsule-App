import { Fragment, useState, type ReactNode } from "react";
import type { ChatMessage, Run, RunTask } from "@capsule/shared";
import type { TranscriptRow } from "../../lib/turn-timeline";
import { formatFullStamp, formatStamp } from "../../lib/display-prefs";
import { formatDuration } from "../../lib/turns";
import { ChevronRightIcon } from "../shell/icons";
import { InlineActivity } from "./InlineActivity";
import { WorkNoteRow } from "./WorkNoteRow";
import { TurnPlan } from "./TurnPlan";

interface Props {
  rows: TranscriptRow[];
  run?: Run;
  stopping?: boolean;
  partial?: boolean;
  /** The run's last reported plan; shown once the turn has settled. */
  plan?: readonly RunTask[];
  /** The turn's checks, kept at the foot of the folded work. */
  details?: ReactNode;
  onOpenFile?: (path: string, root?: string) => void;
  /** The message find has selected; the fold opens when that message is inside it. */
  reveal?: string;
  children: (message: ChatMessage) => ReactNode;
}

const SETTLED: ReadonlyArray<Run["status"]> = ["completed", "failed", "cancelled", "blocked"];

function workLabel(run: Run | undefined, elapsed: number): string {
  const duration = Number.isFinite(elapsed) && elapsed >= 0 ? formatDuration(elapsed) : undefined;
  const stoppedByYou = run?.status === "cancelled" && !run.error?.startsWith("Interrupted");
  if (stoppedByYou) return duration ? `You stopped after ${duration}` : "You stopped this turn";
  return duration ? `Worked for ${duration}` : "Worked";
}

/**
 * Live work stays chronological. Once a turn settles, everything between the
 * prompt and the answer folds under one row: tool calls and the progress
 * notes the agent wrote along the way. Only the answer stays open.
 */
export function TurnTranscript({ rows, run, stopping, partial, plan, details, onOpenFile, reveal, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  // Once opened, the fold stays mounted while closed, so what was opened inside it stays open.
  const [visited, setVisited] = useState(false);
  const [revealed, setRevealed] = useState<string>();
  const renderRow = (row: TranscriptRow) => <Fragment key={row.id}>{row.kind === "message"
    ? children(row.message)
    : row.kind === "note" ? <WorkNoteRow note={row.note} />
      : run && <InlineActivity tools={row.tools} run={run} stopping={stopping}
        onOpenFile={onOpenFile ? (path) => onOpenFile(path, run.workingDirectory) : undefined} />}</Fragment>;
  const settled = !run || SETTLED.includes(run.status);
  const finalIndex = rows.reduce((last, row, index) => row.kind === "message" && row.message.role === "assistant" ? index : last, -1);
  const promptEnd = rows[0]?.kind === "message" && rows[0].message.role === "user" ? 1 : 0;
  const between = finalIndex < 0 ? [] : rows.slice(promptEnd, finalIndex);
  // A compaction changes what the agent remembers, so it stays in view rather than inside the fold.
  const isCompaction = (row: TranscriptRow) => row.kind === "note" && row.note.kind === "compaction";
  const work = between.filter((row) => !isCompaction(row));
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (work.some((row) => row.kind === "message" && row.message.id === reveal)) { setVisited(true); setExpanded(true); }
  }
  const earlier = partial && <p className="faint">Showing recent activity.{run?.status === "failed" || run?.status === "blocked" ? " Turn details below have the rest." : ""}</p>;
  const planCard = settled && plan?.length ? <TurnPlan tasks={plan} /> : null;
  if (!settled || work.length === 0) return <>{earlier}{rows.slice(0, promptEnd).map(renderRow)}{planCard}{rows.slice(promptEnd).map(renderRow)}</>;
  const prompt = rows[0]?.kind === "message" ? rows[0].message : undefined;
  const answer = rows[finalIndex]?.kind === "message" ? (rows[finalIndex] as Extract<TranscriptRow, { kind: "message" }>).message : undefined;
  const startedAt = run?.createdAt ?? prompt?.createdAt ?? "";
  const endedAt = run?.completedAt ?? answer?.createdAt ?? "";
  const elapsed = Date.parse(endedAt) - Date.parse(startedAt);
  return <>
    {rows.slice(0, promptEnd).map(renderRow)}
    {planCard}
    <section className="turn-work">
      <button type="button" className="turn-work-toggle" aria-expanded={expanded} onClick={() => { setVisited(true); setExpanded((value) => !value); }}>
        <span>{workLabel(run, elapsed)}</span>
        <ChevronRightIcon size={13} className={expanded ? "open" : ""} aria-hidden />
        {endedAt && Number.isFinite(Date.parse(endedAt)) && <time className="turn-work-time" dateTime={endedAt} title={formatFullStamp(endedAt)}>{formatStamp(endedAt)}</time>}
      </button>
      {visited && <div className="turn-work-body" hidden={!expanded}>{earlier}{work.map(renderRow)}{details}</div>}
    </section>
    {between.filter(isCompaction).map(renderRow)}
    {rows.slice(finalIndex).map(renderRow)}
  </>;
}
