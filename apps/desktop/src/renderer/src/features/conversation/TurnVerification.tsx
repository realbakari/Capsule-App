import { useState } from "react";
import type { Run, VerificationResult, VerificationState } from "@capsule/shared";
import { projectActionOverrides } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { ChevronRightIcon, PlusIcon, ShieldIcon } from "../shell/icons";

const stateLabels: Record<VerificationState, string> = {
  passed: "Checks passed", failed: "Check failed", unverified: "Not verified", stale: "Out of date",
};

/**
 * The receipt belongs to this turn, not the currently selected repository.
 * Drawn only where there is something to run or something already found: a
 * project with no saved check and a turn with no evidence has nothing to say.
 */
export function TurnVerification({ run }: { run: Run; }) {
  const { api, projects, settings, refresh } = useWorkspace();
  const [result, setResult] = useState<VerificationResult>();
  const [actionId, setActionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("Tests");
  const [command, setCommand] = useState("");
  const [saving, setSaving] = useState(false);
  if (run.status !== "completed") return null;
  const project = projects.find((p) => p.id === run.projectId);
  const actions = project?.actions ?? [];
  const localActions = projectActionOverrides(project?.projectFile?.status === "ok" ? project.projectFile.file.actions : [], actions);
  const selectedId = actionId || (actions.length === 1 ? actions[0]!.id : "");
  const action = actions.find((item) => item.id === selectedId);
  const latest = result && (!run.verification || result.createdAt >= run.verification.createdAt) ? result : run.verification;
  const evidence = latest?.evidence;
  const running = busy || latest?.inProgress === true;
  if (actions.length === 0 && !evidence && !running) return null;
  const blocked = !run.revision || settings?.sandbox === "strict";
  async function check(id?: string) {
    setBusy(true); setError(undefined);
    try { setResult(await api.verifyRun(run.id, id)); }
    catch (cause) { setError(formatUserError(cause)); }
    finally { setBusy(false); }
  }
  async function saveCheck() {
    if (!project || !name.trim() || !command.trim() || localActions.length >= 24) return;
    setSaving(true); setError(undefined);
    try {
      const next = { id: crypto.randomUUID(), name: name.trim(), command: command.trim() };
      await api.updateProject(project.id, { actions: [...localActions, next] });
      await refresh();
      setActionId(next.id); setAdding(false); setCommand("");
    } catch (cause) { setError(formatUserError(cause)); }
    finally { setSaving(false); }
  }
  return (
    <details className="turn-verification" data-verification-run={run.id}>
      <summary><ShieldIcon size={14} /><span>Verification</span><span className={`verification-state ${latest?.status ?? "unverified"}`}>{running ? "Checking…" : stateLabels[latest?.status ?? "unverified"]}</span><ChevronRightIcon className="verification-chevron" size={13} /></summary>
      <div className="verification-body">
        <p className="muted">{running ? "Running the saved check in this turn’s folder…" : evidence ? latest?.summary : "Nothing has checked this turn yet. The agent finishing is not proof it works: run a test or build to check."}</p>
        {!run.revision && <p className="muted">No saved revision is available for this turn.</p>}
        {actions.length > 0 && <>
          <label className="verification-action field">Saved project check<select aria-label="Verification action" value={selectedId} disabled={running || blocked || saving} onChange={(e) => setActionId(e.target.value)}><option value="">Choose a check…</option>{actions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          {action && <code className="verification-command">{action.command}</code>}
          <p className="faint">Runs on this computer. Only run a command you trust; it can modify files. Checks stop after two minutes.</p>
        </>}
        {actions.length === 0 && <p className="muted">{project ? "Add the command that tests or builds this project, then run it here." : "This turn’s project is no longer available. Existing evidence is still shown below."}</p>}
        {adding && <form className="verification-add" onSubmit={(event) => { event.preventDefault(); void saveCheck(); }}>
          <label className="field">Check name<input value={name} maxLength={60} disabled={saving} onChange={(e) => setName(e.target.value)} required /></label>
          <label className="field">Command<input value={command} placeholder="node --test" maxLength={2000} disabled={saving} onChange={(e) => setCommand(e.target.value)} required /></label>
          <p className="faint">Saving adds a project action. It does not run the command.</p>
          <div className="actions"><button type="submit" className="send" disabled={saving || !name.trim() || !command.trim()}>{saving ? "Saving…" : "Save check"}</button><button type="button" className="ghost" disabled={saving} onClick={() => setAdding(false)}>Cancel</button></div>
        </form>}
        {settings?.sandbox === "strict" && <p className="muted">Strict sandbox mode disables shell checks.</p>}
        <div className="actions">
          {running ? <button type="button" className="ghost" onClick={() => void api.cancelVerification(run.id).catch((e: unknown) => setError(formatUserError(e)))}>Cancel check</button> : actions.length > 0 && <button type="button" className="send" disabled={!action || blocked || saving} onClick={() => void check(selectedId)}>Run selected check</button>}
          {project && localActions.length < 24 && !adding && <button type="button" className="ghost" disabled={running} onClick={() => setAdding(true)}><PlusIcon size={13} />Add check</button>}
          {evidence && <button type="button" className="ghost" disabled={running || !run.revision} onClick={() => void check()}>Recheck evidence</button>}
        </div>
        {evidence && <details className="verification-details"><summary>Check output · {new Date(evidence.completedAt).toLocaleString()}</summary><p><code>{evidence.command}</code> · Exit {evidence.exitCode ?? "not recorded"}</p><pre>{evidence.output || "No output."}</pre><p className="faint">Output shows the last 20,000 characters.</p></details>}
        <details className="verification-details"><summary>How this is checked</summary>
          <p className="muted">Checks run on this computer, in this turn’s folder, so they do not cover files on a remote agent’s machine. A pass means the command succeeded on these files; it does not prove every requirement is met.</p>
          {run.workingDirectory && <code className="verification-path">{run.workingDirectory}</code>}
        </details>
        {error && <p className="verification-error" role="alert">{error}</p>}
      </div>
    </details>
  );
}
