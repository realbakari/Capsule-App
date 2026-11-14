import { useEffect, useState } from "react";
import { STATUS_LINE_ITEMS, statusLineParts, type StatusLineConfig, type StatusLineFacts, type StatusLineItem } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { StatusLine } from "./StatusLine";
import "../conversation/commands.css";
import "./status-line.css";

const LABELS: Record<StatusLineItem, string> = {
  branch: "Branch",
  changes: "Changed files",
  context: "Context used",
  limits: "Usage limit and reset",
  pr: "Pull request",
  model: "Model",
  harness: "Agent and route",
  run: "Latest turn",
  cost: "Cost, when the agent reports it",
};

const SAMPLE: StatusLineFacts = {
  branch: "feature/search",
  changes: 3,
  context: { used: 61_000, size: 200_000 },
  limits: { usedPercent: 42, resetsAt: new Date(new Date().setHours(17, 0, 0, 0)).toISOString() },
  pr: { number: 128, state: "OPEN", checks: "success" },
  model: "sonnet",
  harness: "Claude Code",
  route: "direct",
  run: "completed",
  cost: { amount: 0.42, currency: "USD" },
};

const EXAMPLE = `#!/bin/sh
# Reads the thread as JSON on stdin; prints up to two lines.
input=$(cat)
branch=$(printf '%s' "$input" | jq -r '.branch // "-"')
printf '\\033[32m%s\\033[0m  %s%% context\\n' "$branch" "$(printf '%s' "$input" | jq -r '.context_percent // 0')"`;

/** Settings → Appearance → Status line: pick items with no code, or name your own command. */
export function StatusLineSettings() {
  const { api, config } = useWorkspace();
  const current = config?.statusLine;
  const items = current?.items ?? [];
  const [command, setCommand] = useState(current?.command ?? "");
  const [interval, setIntervalText] = useState(current?.refreshInterval ? String(current.refreshInterval) : "");
  const [failure, setFailure] = useState<string>();
  const desktop = api.isDesktop === true && !config?.safeMode;
  useEffect(() => { setCommand(current?.command ?? ""); }, [current?.command]);
  useEffect(() => { setIntervalText(current?.refreshInterval ? String(current.refreshInterval) : ""); }, [current?.refreshInterval]);

  const write = (next: StatusLineConfig) => {
    setFailure(undefined);
    const value: StatusLineConfig = {
      ...(next.items?.length ? { items: next.items } : {}),
      ...(next.command?.trim() ? { command: next.command.trim() } : {}),
      ...(next.refreshInterval ? { refreshInterval: next.refreshInterval } : {}),
    };
    void api.configSetValue({ key: "statusLine", value: Object.keys(value).length ? value : undefined, scope: "user" })
      .catch((caught: unknown) => setFailure(formatUserError(caught)));
  };
  const base = (): StatusLineConfig => ({ items, command: current?.command, refreshInterval: current?.refreshInterval });
  const toggle = (item: StatusLineItem, on: boolean) =>
    write({ ...base(), items: on ? [...items, item] : items.filter((value) => value !== item) });
  const move = (item: StatusLineItem, by: -1 | 1) => {
    const at = items.indexOf(item);
    const to = at + by;
    if (at < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    next.splice(at, 1);
    next.splice(to, 0, item);
    write({ ...base(), items: next });
  };
  const order = [...items, ...STATUS_LINE_ITEMS.filter((item) => !items.includes(item))];
  const preview = statusLineParts(items, SAMPLE);
  const seconds = Number(interval);
  const intervalValid = !interval || (Number.isFinite(seconds) && seconds >= 1);

  return (
    <div className="card commands-card status-line-card">
      <h3>Status line</h3>
      <p className="muted">A line under the composer for what you want to see at a glance. Pick items, or run your own command and show what it prints.</p>
      {failure && <p className="commands-card-error" role="alert">{failure}</p>}
      <h4 className="commands-card-subhead">Items</h4>
      <ul className="status-line-items" aria-label="Status line items">
        {order.map((item) => {
          const on = items.includes(item);
          const at = items.indexOf(item);
          return (
            <li key={item}>
              <label>
                <input type="checkbox" checked={on} disabled={!desktop} onChange={(event) => toggle(item, event.target.checked)} />
                {LABELS[item]}
              </label>
              {on && <span className="status-line-move">
                <button type="button" className="icon-btn" aria-label={`Move ${LABELS[item]} earlier`} disabled={!desktop || at === 0} onClick={() => move(item, -1)}>↑</button>
                <button type="button" className="icon-btn" aria-label={`Move ${LABELS[item]} later`} disabled={!desktop || at === items.length - 1} onClick={() => move(item, 1)}>↓</button>
              </span>}
            </li>
          );
        })}
      </ul>
      <div className="status-line-preview" aria-label="Preview">
        <span className="faint">Preview</span>
        {current?.command ? <span className="status-line-preview-live"><StatusLine /></span>
          : preview.length ? <div className="status-line" data-mode="items"><span className="status-line-row">{preview.map((part) => <span key={part.item} className="status-line-part" data-tone={part.tone}>{part.text}</span>)}</span></div>
          : <span className="faint">Pick an item to see it here.</span>}
      </div>
      {current?.command && <p className="muted">Your command replaces the items while it is set. The preview shows its output for the open thread.</p>}
      <h4 className="commands-card-subhead">Your own command</h4>
      <p className="muted">
        Runs on this computer with the thread as JSON on stdin, at most once a second, and prints up to two lines. Colours are kept.
        Only your own settings file can set it; a project's file cannot.
      </p>
      <div className="status-line-command">
        <input type="text" spellCheck={false} aria-label="Status line command" placeholder="~/.capsule/statusline.sh" value={command} disabled={!desktop}
          onChange={(event) => setCommand(event.target.value)} />
        <input type="number" min={1} aria-label="Refresh every N seconds" placeholder="Refresh (s)" value={interval} disabled={!desktop}
          onChange={(event) => setIntervalText(event.target.value)} />
        <button type="button" className="chip" disabled={!desktop || !intervalValid || (command.trim() === (current?.command ?? "") && (interval ? seconds : undefined) === current?.refreshInterval)}
          onClick={() => write({ ...base(), command, refreshInterval: interval ? Math.floor(seconds) : undefined })}>Save</button>
      </div>
      <details className="advanced">
        <summary>What the command reads</summary>
        <p className="muted"><code>thread_id</code>, <code>project_dir</code>, <code>cwd</code>, <code>harness</code>, <code>route</code>, <code>model</code>, <code>context_percent</code>, <code>rate_limits</code>, <code>pr</code>, <code>run_status</code>, <code>branch</code>, <code>changes</code> and <code>cost</code>. Missing values are <code>null</code>. It has 5 seconds.</p>
        <pre>{EXAMPLE}</pre>
      </details>
    </div>
  );
}
