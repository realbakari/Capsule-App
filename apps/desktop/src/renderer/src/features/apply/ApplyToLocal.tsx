import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ApplyResult, Session, WorktreeApplyStatus } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useModalFocus } from "../../lib/modal-focus";
import { compactRelativeTime } from "../../lib/sidebar";
import { useWorkspace } from "../../lib/workspace";
import { AlertTriangleIcon, CheckIcon, GitMergeIcon, UndoIcon } from "../shell/icons";
import "./apply-to-local.css";

/*
 * Apply to local: a worktree conversation's changes land on the project's own
 * checkout as unstaged edits. The provider owns the one status reading for the
 * selected thread and the outcome of the last apply, so the details row, the
 * title menu and the palette agree, and the toast or conflict dialog outlives
 * whichever of them started it.
 */

type Outcome =
  | { kind: "applied"; session: Session; result: ApplyResult }
  | { kind: "undone"; files: number }
  | { kind: "failed"; action: "apply" | "undo"; detail: string };

interface ApplyToLocalValue {
  /** False for a local thread or a paired device: the entry points are not shown. */
  offered: boolean;
  status?: WorktreeApplyStatus;
  busy?: "apply" | "undo";
  /** Why Apply is unavailable, in words for the control that is disabled. */
  disabledReason?: string;
  apply: () => void;
  undo: (undoRef: string) => void;
  /** Read the status again, e.g. when a surface showing it opens. */
  refresh: () => void;
}

const ApplyToLocalContext = createContext<ApplyToLocalValue>({ offered: false, apply: () => undefined, undo: () => undefined, refresh: () => undefined });

export function useApplyToLocal(): ApplyToLocalValue {
  return useContext(ApplyToLocalContext);
}

const TOAST_MS = 10_000;

export function ApplyToLocalProvider({ children }: { children: ReactNode }) {
  const { api, session, activeRun, git } = useWorkspace();
  const offered = api.isDesktop !== false && session?.workspaceMode === "worktree" && Boolean(session.workingDirectory);
  const [status, setStatus] = useState<{ sessionId: string; value: WorktreeApplyStatus }>();
  const [busy, setBusy] = useState<"apply" | "undo">();
  const [outcome, setOutcome] = useState<Outcome>();
  const [reload, setReload] = useState(0);
  const sessionId = offered ? session?.id : undefined;
  /* What the worktree looks like now: a new edit or a finished turn changes the answer. */
  const gitKey = git ? `${git.branch}|${git.changed}|${git.added}|${git.removed}` : "";

  useEffect(() => {
    if (!sessionId) return undefined;
    let current = true;
    void api.worktreeApplyStatus(sessionId).then(
      (value) => { if (current) setStatus({ sessionId, value }); },
      (error) => { if (current) setStatus({ sessionId, value: { available: false, reason: formatUserError(error), files: 0 } }); },
    );
    return () => { current = false; };
  }, [api, sessionId, session?.updatedAt, activeRun?.id, activeRun?.status, gitKey, reload]);

  const apply = useCallback(() => {
    if (!session || busy) return;
    setBusy("apply");
    setOutcome(undefined);
    void api.applyWorktreeToLocal(session.id).then(
      (result) => setOutcome(result.applied ? { kind: "applied", session, result } : { kind: "failed", action: "apply", detail: result.detail ?? "Nothing was applied." }),
      (error) => setOutcome({ kind: "failed", action: "apply", detail: formatUserError(error) }),
    ).finally(() => { setBusy(undefined); setReload((value) => value + 1); });
  }, [api, session, busy]);

  const undo = useCallback((undoRef: string) => {
    const owner = outcome?.kind === "applied" ? outcome.session.id : session?.id;
    if (!owner || busy) return;
    setBusy("undo");
    void api.undoApplyToLocal(owner, undoRef).then(
      (result) => setOutcome(result.ok ? { kind: "undone", files: result.files.length } : { kind: "failed", action: "undo", detail: result.detail }),
      (error) => setOutcome({ kind: "failed", action: "undo", detail: formatUserError(error) }),
    ).finally(() => { setBusy(undefined); setReload((value) => value + 1); });
  }, [api, session?.id, outcome, busy]);

  const value = useMemo<ApplyToLocalValue>(() => {
    const known = status?.sessionId === sessionId ? status?.value : undefined;
    const disabledReason = busy === "apply" ? "Applying…" : !known ? "Checking the worktree…" : known.available ? undefined : known.reason;
    const refresh = () => setReload((value) => value + 1);
    return { offered, status: known, busy, disabledReason, apply, undo, refresh };
  }, [offered, status, sessionId, busy, apply, undo]);

  return (
    <ApplyToLocalContext.Provider value={value}>
      {children}
      <ApplyOutcome outcome={outcome} busy={busy} onUndo={undo} onClose={() => setOutcome(undefined)} />
    </ApplyToLocalContext.Provider>
  );
}

function appliedAgo(at: string): string {
  const relative = compactRelativeTime(at);
  return relative === "now" || relative === "0m" || !relative ? "just now" : `${relative} ago`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function ApplyOutcome({ outcome, busy, onUndo, onClose }: { outcome?: Outcome; busy?: "apply" | "undo"; onUndo: (undoRef: string) => void; onClose: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  const toast = outcome && !(outcome.kind === "applied" && outcome.result.conflicts.length > 0);
  useEffect(() => {
    if (!toast || outcome?.kind === "failed") return undefined;
    const timer = setTimeout(() => close.current(), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast, outcome]);
  if (!outcome) return null;
  if (outcome.kind === "applied" && outcome.result.conflicts.length > 0) {
    return <ConflictDialog session={outcome.session} result={outcome.result} busy={busy} onUndo={onUndo} onClose={onClose} />;
  }
  if (outcome.kind === "applied") {
    const { result } = outcome;
    return (
      <div className="apply-toast" role="status">
        <CheckIcon size={14} />
        <span>Applied {plural(result.files.length, "file")} to the project folder{result.detail ? `. ${result.detail}` : ""}</span>
        {result.undoRef && <button type="button" className="ghost" data-undo disabled={busy === "undo"} onClick={() => onUndo(result.undoRef!)}>{busy === "undo" ? "Undoing…" : "Undo"}</button>}
        <button type="button" className="ghost" aria-label="Dismiss" onClick={onClose}>×</button>
      </div>
    );
  }
  if (outcome.kind === "undone") {
    return (
      <div className="apply-toast" role="status">
        <UndoIcon size={14} />
        <span>Undid the apply. {plural(outcome.files, "file")} back as they were.</span>
        <button type="button" className="ghost" aria-label="Dismiss" onClick={onClose}>×</button>
      </div>
    );
  }
  return (
    <div className="apply-toast error" role="alert">
      <AlertTriangleIcon size={14} />
      <span>{outcome.action === "apply" ? "Could not apply" : "Could not undo"}: {outcome.detail}</span>
      <button type="button" className="ghost" aria-label="Dismiss" onClick={onClose}>×</button>
    </div>
  );
}

function resolvePrompt(branch: string | undefined, conflicts: string[]): string {
  return [
    `Applying the worktree branch ${branch ? `\`${branch}\`` : "from another conversation"} to this folder left conflict markers in ${conflicts.length === 1 ? "this file" : "these files"}:`,
    "",
    ...conflicts.map((file) => `- \`${file}\``),
    "",
    "Resolve each conflict so both sides' intent survives, and ask me where they cannot both stand. Remove every conflict marker and leave the result unstaged for me to review.",
  ].join("\n");
}

function ConflictDialog({ session, result, busy, onUndo, onClose }: { session: Session; result: ApplyResult; busy?: "apply" | "undo"; onUndo: (undoRef: string) => void; onClose: () => void }) {
  const { api, settings, sessions, setProjectId, setView, openInspector, refresh } = useWorkspace();
  const dialog = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  /* A send that failed keeps its thread, so a retry does not start a second one. */
  const resolveThread = useRef<string | undefined>(undefined);
  useModalFocus(dialog, true, onClose, "[data-primary]");

  /*
   * The project's own folder is what changed, and Review follows the selected
   * thread's folder: open it from a thread that shares the project folder,
   * starting an empty one when the project has none.
   */
  const openReview = async () => {
    setError(undefined);
    try {
      const local = sessions.find((item) => item.projectId === session.projectId && item.state === "active" && item.workspaceMode !== "worktree")
        ?? await api.createSession({ projectId: session.projectId, agentId: session.harnessId ?? session.agentId, mode: session.mode, permissionProfile: settings?.defaultPermission, workspaceMode: "local", title: "New conversation" });
      onClose();
      setProjectId(session.projectId, local.id);
      setView("chat");
      openInspector("changes");
      await refresh();
    } catch (failure) {
      setError(`Could not open Review: ${formatUserError(failure)}`);
    }
  };

  const askAgent = async () => {
    setAsking(true);
    setError(undefined);
    try {
      const agentId = session.harnessId ?? session.agentId;
      resolveThread.current ??= (await api.createSession({
        projectId: session.projectId,
        agentId,
        mode: session.mode,
        permissionProfile: settings?.defaultPermission,
        workspaceMode: "local",
        title: "Resolve apply conflicts",
      })).id;
      const created = { id: resolveThread.current };
      await api.sendMessage({ sessionId: created.id, content: resolvePrompt(session.worktreeBranch, result.conflicts), agentId, mode: session.mode });
      onClose();
      setProjectId(session.projectId, created.id);
      setView("chat");
      await refresh();
    } catch (failure) {
      setError(`Could not start the conversation: ${formatUserError(failure)}`);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="palette-backdrop center" onClick={onClose}>
      <div className="dialog apply-conflicts" ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="apply-conflicts-title" aria-describedby="apply-conflicts-detail" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <h3 id="apply-conflicts-title"><AlertTriangleIcon size={16} />Applied with conflicts</h3>
        <p id="apply-conflicts-detail">
          {plural(result.files.length, "file")} from {session.worktreeBranch ? <span className="mono">{session.worktreeBranch}</span> : "the worktree"} landed in the project folder.
          {" "}{result.conflicts.length === 1 ? "One has" : `${result.conflicts.length} have`} conflict markers to resolve:
        </p>
        <ul className="apply-conflicts-files" aria-label="Files with conflicts">
          {result.conflicts.map((file) => <li key={file} className="mono" title={file}>{file}</li>)}
        </ul>
        {error && <p className="apply-conflicts-error" role="alert">{error}</p>}
        <div className="actions">
          {result.undoRef && (
            <button type="button" className="ghost" disabled={busy === "undo" || asking} onClick={() => onUndo(result.undoRef!)}>
              {busy === "undo" ? "Undoing…" : "Undo apply"}
            </button>
          )}
          <button type="button" className="ghost" disabled={asking || busy === "undo"} onClick={() => void askAgent()}>
            {asking ? "Starting…" : "Ask the agent to resolve"}
          </button>
          <button type="button" className="send" data-primary disabled={busy === "undo"} onClick={() => void openReview()}>Open Review</button>
        </div>
      </div>
    </div>
  );
}

/** The worktree section of Conversation details: apply, and the last apply until the next turn. */
export function ApplyToLocalRow({ onApply }: { onApply?: () => void }) {
  const { offered, status, busy, disabledReason, apply, undo, refresh } = useApplyToLocal();
  /* A merge finished or a file saved outside Capsule changes the answer without a Git status event. */
  useEffect(() => { if (offered) refresh(); }, [offered]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!offered) return null;
  const last = status?.lastApply;
  return (
    <div className="apply-local" role="group" aria-label="Apply to local checkout">
      <button
        type="button"
        className="session-details-action"
        disabled={Boolean(disabledReason)}
        aria-describedby={disabledReason ? "apply-local-reason" : undefined}
        onClick={() => { onApply?.(); apply(); }}
      >
        <GitMergeIcon size={14} />
        <span>{busy === "apply" ? "Applying to local checkout…" : last ? "Apply to local checkout again" : "Apply to local checkout"}</span>
        {!disabledReason && status ? <span className="apply-local-count">{plural(status.files, "file")}</span> : null}
      </button>
      {disabledReason && busy !== "apply" ? <p id="apply-local-reason" className="apply-local-reason">{disabledReason}</p> : null}
      {last ? (
        <p className="apply-local-last">
          {last.conflicts.length ? <AlertTriangleIcon size={14} className="warn" /> : <CheckIcon size={14} />}
          <span title={new Date(last.at).toLocaleString()}>
            Applied to local {appliedAgo(last.at)}
            {last.conflicts.length ? ` · ${plural(last.conflicts.length, "conflict")}` : ""}
          </span>
          <button type="button" className="link-btn" disabled={busy === "undo"} onClick={() => undo(last.undoRef)}>{busy === "undo" ? "Undoing…" : "Undo"}</button>
        </p>
      ) : null}
    </div>
  );
}
