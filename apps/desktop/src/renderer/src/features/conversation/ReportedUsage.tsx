import { readReportedContextUsage, readReportedTurnUsage, type RunEvent } from "@capsule/shared";
import { formatTokens } from "../../lib/context-window";

/** A bounded page's latest reports, not accounting totals or verified invoices. */
export function ReportedUsage({ events }: { events: readonly RunEvent[] }) {
  const contextEvent = [...events].reverse().find((event) => event.type === "usage.context");
  const turnEvent = [...events].reverse().find((event) => event.type === "usage.turn");
  const context = readReportedContextUsage(contextEvent?.data?.context);
  const turn = readReportedTurnUsage(turnEvent?.data?.usage);
  if (!context && !turn) return null;
  return <details className="reported-usage"><summary><span>Agent-reported usage</span>{context && <span className="reported-usage-preview">Context {formatTokens(context.used)} / {formatTokens(context.size)}</span>}</summary>
    <dl>
      {context && <div><dt>Context occupancy</dt><dd>{formatTokens(context.used)} / {formatTokens(context.size)}</dd></div>}
      {turn && <div><dt>This turn</dt><dd>Input {turn.inputTokens === undefined ? "not reported" : formatTokens(turn.inputTokens)} · Output {turn.outputTokens === undefined ? "not reported" : formatTokens(turn.outputTokens)} · Total {turn.totalTokens === undefined ? "not reported" : formatTokens(turn.totalTokens)}</dd></div>}
      {context?.cost && <div><dt>Reported cumulative session cost</dt><dd>{context.cost.amount} {context.cost.currency}</dd></div>}
    </dl>
    <p className="faint">Latest reports on this page, not transcript totals. Context, turn tokens and session cost are separate measures.</p>
  </details>;
}
