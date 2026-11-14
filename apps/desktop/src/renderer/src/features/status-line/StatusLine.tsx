import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  readReportedContextUsage,
  statusLineKey,
  statusLineParts,
  type AnsiSegment,
  type ProviderUsageSnapshot,
  type StatusLineFacts,
  type StatusLineRender,
} from "@capsule/shared";
import { contextUsageFromEvents } from "../../lib/context-window";
import { harnessDisplayName } from "../../lib/harness";
import { useWorkspace } from "../../lib/workspace";
import "./status-line.css";

/** What the window already shows about the open thread, gathered for the status line. */
function useStatusLineFacts(): StatusLineFacts {
  const { session, git, events, runs, harnesses, harnessStatuses, api } = useWorkspace();
  const [usage, setUsage] = useState<ProviderUsageSnapshot>();
  useEffect(() => {
    if (typeof api.providerUsage !== "function") return undefined;
    let active = true;
    const read = () => { void api.providerUsage().then((next) => { if (active) setUsage(next); }).catch(() => undefined); };
    read();
    const off = api.on("state", (payload) => { if ((payload as { command?: string }).command === "provider-usage") read(); });
    return () => { active = false; off(); };
  }, [api]);

  return useMemo(() => {
    const facts: StatusLineFacts = {};
    if (git?.isRepo && git.branch) facts.branch = git.branch;
    if (git?.isRepo) facts.changes = git.changed;
    const context = contextUsageFromEvents(events);
    if (context) facts.context = { used: context.used, size: context.limit };
    for (let index = events.length - 1; index >= 0; index--) {
      const cost = events[index]!.type === "usage.context" ? readReportedContextUsage(events[index]!.data?.context)?.cost : undefined;
      if (cost) { facts.cost = cost; break; }
    }
    const report = session ? usage?.reports.find((source) => source.sessionId === session.id)?.report : undefined;
    if (report) facts.limits = { usedPercent: report.window.usedPercent, resetsAt: new Date(report.window.resetsAtMs).toISOString() };
    const pr = git?.pullRequest;
    if (pr) facts.pr = { number: pr.number, state: pr.state, ...(pr.isDraft ? { draft: true } : {}), ...(pr.checks ? { checks: pr.checks } : {}) };
    if (session?.harnessId) {
      facts.harness = harnessDisplayName(harnesses, session.harnessId);
      facts.route = session.directSession || session.carryOver?.route === "direct" ? "direct" : session.openclawSessionKey ? "gateway" : undefined;
      if (!facts.route) delete facts.route;
      const model = harnessStatuses[session.id]?.parsed?.model ?? session.modelOverride;
      if (model) facts.model = model;
    }
    const latest = [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
    if (latest) facts.run = latest.status;
    return facts;
  }, [git, events, runs, session, harnesses, harnessStatuses, usage]);
}

const NAMED = new Set(["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]);

function segmentStyle(segment: AnsiSegment): { style: CSSProperties; fg?: string; bg?: string } {
  const style: CSSProperties = {};
  const named = (color?: string) => color && NAMED.has(color.replace(/^bright-/, "")) ? color.replace(/^bright-/, "") : undefined;
  if (segment.fg?.startsWith("#")) style.color = segment.fg;
  if (segment.bg?.startsWith("#")) style.backgroundColor = segment.bg;
  if (segment.bold) style.fontWeight = 650;
  if (segment.dim) style.opacity = 0.65;
  if (segment.italic) style.fontStyle = "italic";
  if (segment.underline) style.textDecoration = "underline";
  return { style, fg: named(segment.fg), bg: named(segment.bg) };
}

function Segments({ line }: { line: AnsiSegment[] }) {
  return <>{line.map((segment, index) => {
    const { style, fg, bg } = segmentStyle(segment);
    return <span key={index} className="status-line-seg" data-fg={fg} data-bg={bg} style={style}>{segment.text}</span>;
  })}</>;
}

/** The status line under the composer: chosen items, or the person's own command's output. */
export function StatusLine() {
  const { api, config, projectId, session } = useWorkspace();
  const facts = useStatusLineFacts();
  const configured = config?.statusLine;
  const command = configured?.command;
  const key = projectId ? statusLineKey(projectId, session?.id) : undefined;
  const [render, setRender] = useState<StatusLineRender>();
  const canRun = api.isDesktop === true;

  useEffect(() => {
    setRender(key ? configured?.renders.find((item) => item.key === key) : undefined);
    // Only a thread switch reseeds from the snapshot; later output arrives as events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, command]);

  useEffect(() => {
    if (!key) return undefined;
    const off = api.on("state", (payload) => {
      const event = payload as { command?: string; render?: StatusLineRender };
      if (event.command === "status-line-updated" && event.render?.key === key) setRender(event.render);
    });
    return () => { off(); };
  }, [api, key]);

  const factsJson = JSON.stringify(facts);
  const request = useRef<() => void>(() => {});
  request.current = () => {
    if (!command || !canRun || !projectId) return;
    void api.statusLineRun({ projectId, ...(session?.id ? { sessionId: session.id } : {}), facts }).catch(() => undefined);
  };
  useEffect(() => {
    if (!command || !canRun) return undefined;
    // Main also holds each thread to one run a second; this keeps a burst of renders from asking at all.
    const timer = window.setTimeout(() => request.current(), 300);
    return () => window.clearTimeout(timer);
  }, [command, canRun, key, factsJson]);
  useEffect(() => {
    const every = configured?.refreshInterval;
    if (!command || !canRun || !every) return undefined;
    const timer = window.setInterval(() => request.current(), Math.max(1, every) * 1000);
    return () => window.clearInterval(timer);
  }, [command, canRun, configured?.refreshInterval]);

  if (command) {
    if (!render || (render.lines.length === 0 && !render.failed)) return null;
    const title = render.lines.map((line) => line.map((segment) => segment.text).join("")).join("\n");
    return (
      <div className="status-line" data-mode="command" data-failed={render.failed ? "true" : undefined} title={render.failed ? `Status line failed: ${render.failed}` : title} aria-label="Status line">
        {render.lines.map((line, index) => <span key={index} className="status-line-row"><Segments line={line} /></span>)}
        {render.failed && <span className="status-line-failed">status line failed</span>}
      </div>
    );
  }

  const parts = statusLineParts(configured?.items ?? [], facts);
  if (parts.length === 0) return null;
  return (
    <div className="status-line" data-mode="items" aria-label="Status line" title={parts.map((part) => `${part.title ?? part.item}: ${part.text}`).join("\n")}>
      <span className="status-line-row">
        {parts.map((part) => <span key={part.item} className="status-line-part" data-item={part.item} data-tone={part.tone}>{part.text}</span>)}
      </span>
    </div>
  );
}
