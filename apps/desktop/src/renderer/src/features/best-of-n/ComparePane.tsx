import { useEffect, useMemo, useState } from "react";
import {
  candidatePhase,
  candidateOrdinal,
  keepBlocker,
  parseUnifiedDiff,
  type CandidatePhase,
  type CandidateSummary,
  type DiffFile,
  type GroupComparison,
  type RatingValue,
} from "@capsule/shared";
import { formatTokens } from "../../lib/context-window";
import { formatUserError } from "../../lib/errors";
import { harnessDisplayName } from "../../lib/harness";
import { setReviewScope } from "../../lib/review-scope";
import { formatDuration } from "../../lib/turns";
import { useWorkspace } from "../../lib/workspace";
import { AgentGlyph } from "../shell/AgentGlyph";
import { FileDiff } from "../shell/FileDiff";
import { AlertTriangleIcon, ArchiveIcon, CheckIcon, DiffIcon, GitMergeIcon, MessageSquareIcon, UndoIcon } from "../shell/icons";
import { useBestOfN, useComparison } from "./BestOfN";
import { RatingButtons } from "./RateReply";
import "./best-of-n.css";

const PHASE_LABEL: Record<CandidatePhase, string> = {
  starting: "Starting",
  running: "Working",
  "needs-you": "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/** Ticks once a second while anything is still working, for the elapsed times. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function elapsed(candidate: CandidateSummary, now: number): string | undefined {
  const run = candidate.run;
  if (!run) return undefined;
  const end = run.completedAt ? Date.parse(run.completedAt) : now;
  const ms = end - Date.parse(run.createdAt);
  return Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : undefined;
}

/**
 * Compare: every candidate of one prompt, side by side. A card per
 * candidate says where it is, what it changed, whether its checks passed,
 * what it reported spending, and the start of its reply. "Same file" puts
 * one file's diff from each candidate next to each other, which is the
 * question a comparison usually comes down to.
 */
export function ComparePane() {
  const { session, api } = useWorkspace();
  const groupId = session?.groupId;
  const { comparison, error, loading } = useComparison(groupId);
  const [mode, setMode] = useState<"cards" | "file">("cards");

  if (!groupId) {
    return (
      <div className="compare-pane compare-empty" role="status">
        <p>This thread is not part of a comparison.</p>
        <p className="faint">{api.isDesktop === false ? "Comparisons started on the computer show here." : "In a new conversation, choose Run on… in the composer to send one prompt to several agents and compare what comes back."}</p>
      </div>
    );
  }
  if (error) return <div className="compare-pane compare-empty" role="alert"><AlertTriangleIcon size={16} /><p>Could not read this comparison: {error}</p></div>;
  if (loading || !comparison) {
    return (
      <div className="compare-pane" aria-busy="true" aria-label="Loading the comparison">
        <div className="compare-grid">{[0, 1].map((key) => <div key={key} className="compare-card skeleton-card"><span className="skeleton skeleton-line medium" /><span className="skeleton skeleton-line short" /><span className="skeleton skeleton-line medium" /></div>)}</div>
      </div>
    );
  }
  return (
    <div className="compare-pane">
      <CompareSummary comparison={comparison} mode={mode} onMode={setMode} />
      {mode === "cards" ? (
        <div className="compare-grid">
          {comparison.candidates.map((candidate) => <CandidateCard key={candidate.sessionId} comparison={comparison} candidate={candidate} />)}
        </div>
      ) : <SameFile comparison={comparison} />}
    </div>
  );
}

function CompareSummary({ comparison, mode, onMode }: { comparison: GroupComparison; mode: "cards" | "file"; onMode: (mode: "cards" | "file") => void }) {
  const { harnesses } = useWorkspace();
  const { writable, setAside } = useBestOfN();
  const { group, candidates } = comparison;
  const winner = candidates.find((candidate) => candidate.sessionId === group.winnerSessionId);
  const others = candidates.filter((candidate) => candidate.sessionId !== group.winnerSessionId && !candidate.archived);
  const phases = candidates.map(candidatePhase);
  const working = phases.filter((phase) => phase === "starting" || phase === "running").length;
  return (
    <header className="compare-summary">
      <p className="compare-prompt" title={group.prompt}>{group.prompt}</p>
      <div className="compare-summary-row">
        <span className="compare-summary-meta">
          {candidates.length} agents{working ? ` · ${working} working` : ""}
          {winner ? <> · <CheckIcon size={12} /> Kept {harnessDisplayName(harnesses ?? [], winner.harnessId, "one")}{candidateOrdinal(candidates, winner) ? ` ${candidateOrdinal(candidates, winner)}` : ""}</> : null}
        </span>
        <span className="compare-mode" role="radiogroup" aria-label="Compare by">
          <button type="button" role="radio" aria-checked={mode === "cards"} className={mode === "cards" ? "active" : ""} onClick={() => onMode("cards")}>Candidates</button>
          <button type="button" role="radio" aria-checked={mode === "file"} className={mode === "file" ? "active" : ""} onClick={() => onMode("file")}>Same file</button>
        </span>
      </div>
      {winner && writable && others.length > 0 ? (
        <div className="compare-decided">
          <span>The other {others.length === 1 ? "candidate is" : `${others.length} candidates are`} still in the sidebar with {others.length === 1 ? "its worktree" : "their worktrees"}.</span>
          <button type="button" className="chip" onClick={() => setAside(group, others.length)}><ArchiveIcon size={12} />Set aside the others…</button>
        </div>
      ) : null}
    </header>
  );
}

function CandidateCard({ comparison, candidate }: { comparison: GroupComparison; candidate: CandidateSummary }) {
  const { api, harnesses, setProjectId, setView, openInspector, refresh, setNotice } = useWorkspace();
  const { writable, keep } = useBestOfN();
  const { group } = comparison;
  const phase = candidatePhase(candidate);
  const now = useNow(phase === "running" || phase === "starting");
  const [busy, setBusy] = useState<"keep" | "restore">();
  const [rating, setRating] = useState<RatingValue | undefined>(candidate.rating);
  useEffect(() => setRating(candidate.rating), [candidate.rating]);
  const kept = group.winnerSessionId === candidate.sessionId;
  const ordinal = candidateOrdinal(comparison.candidates, candidate);
  const name = `${harnessDisplayName(harnesses ?? [], candidate.harnessId, candidate.harnessId ?? "Agent")}${ordinal ? ` ${ordinal}` : ""}`;
  const blocker = keepBlocker(group, candidate);
  const time = elapsed(candidate, now);
  const open = () => { setProjectId(group.projectId, candidate.sessionId); setView("chat"); };
  const viewDiff = () => { setReviewScope(group.projectId, "branch"); setProjectId(group.projectId, candidate.sessionId); setView("chat"); openInspector("changes"); };
  const rate = (value: RatingValue | 0) => {
    if (!candidate.run) return;
    setRating(value === 0 ? undefined : value);
    void api.rateRun(candidate.run.id, value).catch((error) => setNotice(`Could not save the rating: ${formatUserError(error)}`));
  };
  const restore = async () => {
    setBusy("restore");
    try { await api.restoreSession(candidate.sessionId); await refresh(); }
    catch (error) { setNotice(`Could not restore this candidate: ${formatUserError(error)}`); }
    finally { setBusy(undefined); }
  };
  const diff = candidate.diff;
  return (
    <article className={`compare-card${kept ? " kept" : ""}${candidate.archived ? " set-aside" : ""}`} data-phase={phase} aria-label={`${name}${candidate.model ? ` ${candidate.model}` : ""}, ${PHASE_LABEL[phase]}`}>
      <header className="compare-card-head">
        <AgentGlyph id={candidate.harnessId} name={name} size={16} />
        <span className="compare-card-name">
          <strong>{name}</strong>
          <small title={candidate.route === "direct" ? "Runs the agent's own CLI on this computer" : candidate.route === "gateway" ? "Runs through the OpenClaw Gateway" : undefined}>
            {candidate.model || "default model"}{candidate.route ? ` · ${candidate.route === "direct" ? "Direct" : "Gateway"}` : ""}
          </small>
        </span>
        {kept ? <span className="compare-badge kept"><CheckIcon size={11} />Kept</span>
          : candidate.archived ? <span className="compare-badge">Set aside</span>
          : <span className={`compare-badge phase-${phase}`}>{phase === "running" || phase === "starting" ? <span className="dot on live" aria-hidden /> : null}{PHASE_LABEL[phase]}{time ? ` · ${time}` : ""}</span>}
      </header>
      <dl className="compare-facts">
        <div>
          <dt>Changes</dt>
          <dd>{!diff ? <span className="faint">{candidate.worktree === "set-aside" ? "Saved; restore to see" : "Worktree missing"}</span>
            : "error" in diff ? <span className="faint" title={diff.error}>Not readable</span>
            : diff.files.length === 0 ? <span className="faint">No changes</span>
            : <>{diff.files.length} {diff.files.length === 1 ? "file" : "files"} <span className="added">+{diff.added}</span> <span className="removed">−{diff.removed}</span></>}</dd>
        </div>
        <div>
          <dt>Checks</dt>
          <dd>{candidate.verification === "passed" ? <span className="added">Passed</span> : candidate.verification === "failed" ? <span className="removed">Failed</span> : candidate.verification === "stale" ? "Out of date" : <span className="faint">Not run</span>}</dd>
        </div>
        <div>
          <dt>Usage</dt>
          <dd>{candidate.usage ? [
            candidate.usage.totalTokens !== undefined ? `${formatTokens(candidate.usage.totalTokens)} tokens`
              : candidate.usage.inputTokens !== undefined || candidate.usage.outputTokens !== undefined ? `${formatTokens(candidate.usage.inputTokens ?? 0)} in · ${formatTokens(candidate.usage.outputTokens ?? 0)} out` : undefined,
            candidate.usage.cost ? `${candidate.usage.cost.amount} ${candidate.usage.cost.currency}` : undefined,
          ].filter(Boolean).join(" · ") : <span className="faint">Not reported</span>}</dd>
        </div>
      </dl>
      {phase === "failed" ? <p className="compare-reply error" role="note"><AlertTriangleIcon size={12} />{candidate.run?.error ?? candidate.startError ?? "This candidate failed."}</p>
        : candidate.reply ? <p className="compare-reply"><span className="compare-reply-text">{candidate.reply}</span></p>
        : <p className="compare-reply faint">{phase === "needs-you" ? "Waiting for your approval in its thread." : phase === "done" || phase === "stopped" ? "No reply was received." : "Waiting for a reply…"}</p>}
      <footer className="compare-card-actions">
        <button type="button" className="ghost" onClick={open}><MessageSquareIcon size={13} />Open conversation</button>
        <button type="button" className="ghost" disabled={candidate.worktree !== "present"} title={candidate.worktree !== "present" ? "Restore this thread to see its diff." : "Review this candidate's branch"} onClick={viewDiff}><DiffIcon size={13} />View diff</button>
        {candidate.run && candidate.reply ? <RatingButtons value={rating} writable={writable} label={`${name}'s result`} onRate={rate} /> : null}
        {writable && candidate.archived ? (
          <button type="button" className="chip compare-primary" disabled={busy === "restore"} onClick={() => void restore()}><UndoIcon size={12} />{busy === "restore" ? "Restoring…" : "Restore"}</button>
        ) : writable && !kept ? (
          <button type="button" className="send compare-primary" disabled={Boolean(blocker) || Boolean(busy)} title={blocker ?? "Apply this candidate's changes to the project folder"}
            aria-describedby={blocker ? `keep-reason-${candidate.sessionId}` : undefined}
            onClick={() => { setBusy("keep"); void keep(group, candidate.sessionId).finally(() => setBusy(undefined)); }}>
            <GitMergeIcon size={12} />{busy === "keep" ? "Applying…" : "Keep this one"}
          </button>
        ) : null}
      </footer>
      {writable && !kept && !candidate.archived && blocker && blocker !== "Wait for this candidate to finish." ? <p id={`keep-reason-${candidate.sessionId}`} className="compare-keep-reason">{blocker}</p> : null}
    </article>
  );
}

/** One file, as each candidate changed it. Earns its place: comparisons usually come down to the same few files. */
function SameFile({ comparison }: { comparison: GroupComparison }) {
  const { api, harnesses } = useWorkspace();
  const files = useMemo(() => {
    const counts = new Map<string, number>();
    for (const candidate of comparison.candidates) {
      if (candidate.diff && "files" in candidate.diff) for (const file of candidate.diff.files) counts.set(file.path, (counts.get(file.path) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [comparison]);
  const [path, setPath] = useState<string>();
  const chosen = path && files.some(([file]) => file === path) ? path : files[0]?.[0];
  const [diffs, setDiffs] = useState<{ path: string; bySession: Record<string, DiffFile | null | string> }>();
  const touched = comparison.candidates.filter((candidate) => candidate.worktree === "present");
  const key = JSON.stringify([chosen, touched.map((candidate) => [candidate.sessionId, candidate.diff && "files" in candidate.diff ? candidate.diff.added + candidate.diff.removed : 0])]);

  useEffect(() => {
    if (!chosen) return undefined;
    let current = true;
    void Promise.all(touched.map(async (candidate) => {
      try {
        const scoped = await api.gitScopedDiff(comparison.group.projectId, "branch", chosen, candidate.sessionId);
        return [candidate.sessionId, parseUnifiedDiff(scoped.patch).find((file) => file.path === chosen) ?? null] as const;
      } catch (error) {
        return [candidate.sessionId, formatUserError(error)] as const;
      }
    })).then((entries) => { if (current) setDiffs({ path: chosen, bySession: Object.fromEntries(entries) }); });
    return () => { current = false; };
  }, [api, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!files.length) return <p className="compare-empty-inline">No candidate has changed a file yet.</p>;
  const loaded = diffs && diffs.path === chosen ? diffs.bySession : undefined;
  return (
    <div className="compare-same-file">
      <label className="compare-file-pick">
        <span>File</span>
        <select value={chosen} onChange={(event) => setPath(event.target.value)}>
          {files.map(([file, count]) => <option key={file} value={file}>{file}{count > 1 ? ` · changed by ${count}` : ""}</option>)}
        </select>
      </label>
      <div className="compare-grid same-file">
        {touched.map((candidate) => {
          const ordinal = candidateOrdinal(comparison.candidates, candidate);
          const name = `${harnessDisplayName(harnesses ?? [], candidate.harnessId, candidate.harnessId ?? "Agent")}${ordinal ? ` ${ordinal}` : ""}`;
          const entry = loaded?.[candidate.sessionId];
          return (
            <section key={candidate.sessionId} className="compare-file-column" aria-label={`${name}'s ${chosen}`}>
              <h4><AgentGlyph id={candidate.harnessId} name={name} size={13} />{name}{candidate.model ? <small>{candidate.model}</small> : null}</h4>
              {!loaded ? <span className="skeleton skeleton-line medium" aria-label="Loading" />
                : typeof entry === "string" ? <p className="faint" role="alert">{entry}</p>
                : !entry ? <p className="faint">Not changed by this agent.</p>
                : <FileDiff file={entry} split={false} defaultOpen />}
            </section>
          );
        })}
      </div>
    </div>
  );
}
