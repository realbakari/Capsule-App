import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChannelHarnessJob, ChannelMessage, HarnessId } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { TerminalIcon, XIcon } from "../shell/icons";

export function ChannelHarnessAction({ channelId, message }: { channelId: string; message: ChannelMessage }) {
  const [open, setOpen] = useState(false);
  const { api } = useWorkspace();
  if (!api.isDesktop || !api.runChannelHarness) return null;
  return <><button type="button" className="icon-btn" aria-label="Run with Capsule" title="Run with Capsule" onClick={() => setOpen(true)}><TerminalIcon size={15} /></button>
    {open && <ChannelHarnessDialog channelId={channelId} message={message} close={() => setOpen(false)} />}</>;
}

function ChannelHarnessDialog({ channelId, message, close }: { channelId: string; message: ChannelMessage; close: () => void }) {
  const { api, projects, harnesses, projectId: selectedProject, setProjectId, setView, refresh } = useWorkspace();
  const [projectId, setProject] = useState(selectedProject ?? projects[0]?.id ?? "");
  const [harnessId, setHarness] = useState<HarnessId | "">("");
  const [job, setJob] = useState<ChannelHarnessJob>();
  const [reply, setReply] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const submitting = useRef(false);
  const actionRevision = useRef(0);
  const edited = useRef(false);
  useEffect(() => {
    alive.current = true;
    const prior = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { alive.current = false; if (prior?.isConnected) prior.focus(); };
  }, []);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const revision = actionRevision.current;
      try {
        const jobs = await api.listChannelHarnessJobs(channelId, message.id);
        if (active && !submitting.current && revision === actionRevision.current) {
          const current = jobs[0]; setJob(current); setLoaded(true);
          if (current?.result && !edited.current) setReply(current.result);
        }
      } catch (reason) { if (active && !submitting.current && revision === actionRevision.current) { setLoaded(true); setError(formatUserError(reason)); } }
      finally { if (active) timer = setTimeout(poll, 1500); }
    }
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [api, channelId, message.id]);
  async function perform(action: () => Promise<void>) {
    if (submitting.current) return;
    actionRevision.current++;
    submitting.current = true; setBusy(true); setError(undefined);
    try { await action(); } catch (reason) { if (alive.current) setError(formatUserError(reason)); }
    finally { submitting.current = false; if (alive.current) setBusy(false); }
  }
  const running = job && ["starting", "queued", "running", "waiting", "approval_required"].includes(job.status);
  return createPortal(<dialog className="channel-harness-dialog" ref={dialog} aria-label="Run with Capsule" onCancel={close}>
    <header><h2>Run with Capsule</h2><button type="button" className="icon-btn" aria-label="Close channel run" onClick={close}><XIcon size={18} /></button></header>
    <p className="channels-hint">Use a Capsule harness for this message. Review the reply before sharing it.</p>
    <blockquote>{message.content.slice(0, 800)}{message.content.length > 800 ? "…" : ""}</blockquote>
    {!loaded ? <p role="status">Checking existing runs…</p> : !job ? <form className="channel-form" onSubmit={(event) => {
      event.preventDefault(); if (!harnessId || !projectId) return;
      void perform(async () => {
        const next = await api.runChannelHarness({ channelId, messageId: message.id, rootId: message.rootId, projectId, harnessId });
        if (alive.current) { setJob(next); if (next.result) setReply(next.result); }
      });
    }}>
      <label>Project<select required value={projectId} disabled={busy} onChange={(event) => setProject(event.target.value)}><option value="">Choose a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Harness<select required value={harnessId} disabled={busy} onChange={(event) => setHarness(event.target.value as HarnessId)}><option value="">Choose a harness</option>{harnesses.map((harness) => <option key={harness.id} value={harness.id}>{harness.name} · {harness.runtimeRoute === "direct" ? "Local" : harness.runtimeRoute === "openclaw" ? "Gateway" : "Configured route"}</option>)}</select></label>
      <details className="channel-run-permissions"><summary>Supervised · Project folder</summary><p className="channels-hint">Uses Capsule’s configured runtime route, not a relay agent host. This new conversation does not inherit Full access or run worktree setup. Direct agents surface supported approval requests; Gateway agents refuse tools that need a prompt. Open the conversation to review permissions. Other channel members cannot start it.</p></details>
      <button className="primary" disabled={busy || !projectId || !harnessId}>{busy ? "Starting…" : "Run selected message"}</button>
    </form> : <section className="channel-run-result">
      <p role="status"><strong>{job.harnessId}</strong> · {job.status.replaceAll("_", " ")}{job.publication === "shared" ? " · Reply shared" : ""}</p>
      {job.sessionId && <button className="ghost" disabled={busy} onClick={() => void perform(async () => { await refresh(); if (alive.current) { setProjectId(job.projectId, job.sessionId); setView("chat"); close(); } })}>Open conversation{job.status === "approval_required" ? " to approve" : ""}</button>}
      {running && job.runId && <button className="ghost" disabled={busy} onClick={() => void perform(async () => { await api.stopRun(job.runId!); })}>Stop run</button>}
      {job.error && <p role="alert" className="channels-error">{job.error}</p>}
      {job.status === "completed" && <>
        <label>Reply preview<textarea aria-label="Channel harness reply" rows={8} value={reply} disabled={job.publication !== "unshared" || busy} onChange={(event) => { edited.current = true; setReply(event.target.value); }} /></label>
        <p className="channels-hint">Sharing publishes this text to the channel thread as your connected identity, labelled with the harness name. Review it for private project information.</p>
        <button className="primary" disabled={busy || job.publication !== "unshared" || !reply.trim() || reply.length > 15800} onClick={() => void perform(async () => {
          const next = await api.shareChannelHarnessReply(job.id, reply); if (alive.current) setJob(next);
        })}>{job.publication === "shared" ? "Reply shared" : "Share reply to thread"}</button>
        {reply.length > 15800 && <p role="alert" className="channels-error">Shorten this reply to 15,800 characters before sharing.</p>}
        {job.publication === "uncertain" && <p role="alert" className="channels-error">Delivery is uncertain. Check the thread before manually posting again.</p>}
      </>}
    </section>}
    {error && <p role="alert" className="channels-error">{error}</p>}
  </dialog>, document.body);
}
