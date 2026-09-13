import { Fragment, useState, type ReactNode } from "react";
import type { ChatMessage, Run } from "@capsule/shared";
import type { TranscriptRow } from "../../lib/turn-timeline";
import { formatDuration } from "../../lib/turns";
import { ChevronRightIcon } from "../shell/icons";
import { InlineActivity } from "./InlineActivity";

interface Props {
  rows: TranscriptRow[];
  run?: Run;
  stopping?: boolean;
  partial?: boolean;
  children: (message: ChatMessage) => ReactNode;
}

/** Live work stays chronological; settled work folds without hiding the answer. */
export function TurnTranscript({ rows, run, stopping, partial, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const renderRow = (row: TranscriptRow) => <Fragment key={row.id}>{row.kind === "message"
    ? children(row.message)
    : run && <InlineActivity tools={row.tools} run={run} stopping={stopping} />}</Fragment>;
  const settled = run && ["completed", "failed", "cancelled", "blocked"].includes(run.status);
  const finalIndex = rows.reduce((last, row, index) => row.kind === "message" && row.message.role === "assistant" ? index : last, -1);
  const promptEnd = rows[0]?.kind === "message" && rows[0].message.role === "user" ? 1 : 0;
  const hasWork = rows.slice(promptEnd, finalIndex).some((row) => row.kind === "activity");
  const earlier = partial && <p className="faint">Showing recent activity. Open Turn details for the available log.</p>;
  if (!settled || !hasWork || finalIndex < 0) return <>{earlier}{rows.map(renderRow)}</>;
  const elapsed = Date.parse(run.completedAt ?? "") - Date.parse(run.createdAt);
  const failures = rows.some((row) => row.kind === "activity" && row.tools.some((tool) => tool.status === "failed"));
  return <>
    {rows.slice(0, promptEnd).map(renderRow)}
    <section className="turn-work">
      <button type="button" className="turn-work-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span>{Number.isFinite(elapsed) && elapsed >= 0 ? `Worked for ${formatDuration(elapsed)}` : "Work details"}</span>
        {failures && <span className="turn-work-failure">Tool failure reported</span>}
        <ChevronRightIcon size={13} className={expanded ? "open" : ""} aria-hidden />
      </button>
      {expanded && <div className="turn-work-body">{earlier}{rows.slice(promptEnd, finalIndex).map(renderRow)}</div>}
    </section>
    {rows.slice(finalIndex).map(renderRow)}
  </>;
}
