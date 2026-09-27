import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isHarnessId, type ChannelRouteStatus } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { TerminalIcon, XIcon } from "../shell/icons";

export function ChannelRouteControl({ channelId, useHarness, change, disabled }: {
  channelId: string; useHarness: boolean; change: (value: boolean) => void; disabled: boolean;
}) {
  const { api, projects, harnesses, projectId: activeProject, setProjectId, setView, refresh } = useWorkspace();
  const [state, setState] = useState<ChannelRouteStatus>();
  const [project, setProject] = useState(activeProject ?? projects[0]?.id ?? "");
  const [harness, setHarness] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const mutation = useRef(false);
  const revision = useRef(0);
  const initialized = useRef(false);
  const alive = useRef(true);
  const changed = useRef(change); changed.current = change;
  useEffect(() => {
    if (!open) return;
    const prior = trigger.current;
    dialog.current?.showModal();
    return () => { if (prior?.isConnected) prior.focus(); };
  }, [open]);
  useEffect(() => {
    if (!api.channelRouteStatus) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    alive.current = true;
    async function poll() {
      const started = revision.current;
      try {
        const next = await api.channelRouteStatus(channelId);
        if (active && !mutation.current && started === revision.current) {
          setState(next);
          if (!initialized.current) {
            initialized.current = true;
            if (next.configuration) { setProject(next.configuration.projectId); setHarness(next.configuration.harnessId); changed.current(next.configuration.enabled); }
          }
          if (!next.configuration?.enabled) changed.current(false);
        }
      } catch (reason) { if (active) setError(formatUserError(reason)); }
      finally { if (active) timer = setTimeout(poll, 1500); }
    }
    void poll(); return () => { active = false; alive.current = false; clearTimeout(timer); };
  }, [api, channelId]);
  if (!api.isDesktop || !api.channelRouteStatus) return null;
  async function configure(enabled: boolean) {
    if (mutation.current || !isHarnessId(harness)) return;
    revision.current++; mutation.current = true; setBusy(true); setError(undefined);
    try {
      const next = await api.configureChannelRoute({ channelId, projectId: project, harnessId: harness, enabled });
      if (alive.current) { setState(next); change(enabled); setOpen(false); }
    } catch (reason) { if (alive.current) setError(formatUserError(reason)); }
    finally { mutation.current = false; if (alive.current) setBusy(false); }
  }
  const configuration = state?.configuration;
  const job = state?.jobs.find((item) => ["starting", "running", "waiting", "approval_required"].includes(item.status)) ?? state?.jobs[0];
  const running = job && ["starting", "queued", "running", "waiting", "approval_required"].includes(job.status);
  return <section className="channel-route-control" aria-label="Channel harness">
    <div className="channel-route-heading">
      <TerminalIcon size={16} />
      <button ref={trigger} type="button" className="ghost" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} disabled={disabled || busy}>
        {configuration?.enabled ? `Capsule · ${harnesses.find((item) => item.id === configuration.harnessId)?.name ?? configuration.harnessId}` : "Connect a Capsule harness"}
      </button>
      {configuration?.enabled && <select aria-label="Channel message destination" disabled={disabled || busy} value={useHarness ? "capsule" : "channel"} onChange={(event) => change(event.target.value === "capsule")}>
        <option value="capsule">Ask Capsule</option><option value="channel">Chat only</option>
      </select>}
    </div>
    {configuration?.enabled && <p className="channels-hint">{projects.find((item) => item.id === configuration.projectId)?.name ?? "Project unavailable"} · {useHarness ? "Sends @capsule · Replies shared to the thread as you" : "No local execution unless your message starts with @capsule"}</p>}
    {open && createPortal(<dialog className="channel-harness-dialog channel-route-dialog" ref={dialog} aria-label="Channel harness setup" onCancel={() => setOpen(false)}>
      <header><h2>Channel harness</h2><button type="button" className="icon-btn" aria-label="Close channel harness setup" onClick={() => setOpen(false)}><XIcon size={18} /></button></header>
      <div className="channel-route-settings">
      <label>Project<select value={project} disabled={busy || configuration?.enabled} onChange={(event) => setProject(event.target.value)}><option value="">Choose project</option>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>Harness<select value={harness} disabled={busy || configuration?.enabled} onChange={(event) => setHarness(event.target.value)}><option value="">Choose harness</option>{harnesses.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.runtimeRoute === "direct" ? "Local" : item.runtimeRoute === "openclaw" ? "Gateway" : "Configured route"}</option>)}</select></label>
      <p className="channels-hint">Your new <code>@capsule</code> messages run in this project while Capsule is open. Replies are shared automatically as you, including any project information in the answer. Only your relay identity can trigger this harness; existing hosted agents are not used.</p>
      <details><summary>Permissions and thread context</summary><p className="channels-hint">Each channel thread keeps one local conversation. New conversations start supervised in the project folder. Open the conversation for approvals, model options and file review. Gateway harnesses refuse tools that require a prompt. Pausing stops new work and automatic replies, but does not stop a running agent.</p></details>
      {(error ?? state?.error) && <p role="alert" className="channels-error">{error ?? state?.error}</p>}
      <button type="button" className="primary" disabled={busy || !state || !project || !isHarnessId(harness)} onClick={() => void configure(!configuration?.enabled)}>{configuration?.enabled ? "Pause channel harness" : "Enable harness and automatic replies"}</button>
      </div>
    </dialog>, document.body)}
    {job && <div className="channel-route-run">
      <span role="status">{job.status.replaceAll("_", " ")}{job.publication === "shared" ? " · Reply posted" : job.publication === "sharing" ? " · Posting reply…" : job.publication === "uncertain" ? " · Delivery uncertain" : ""}</span>
      {job.sessionId && <button type="button" className="ghost" onClick={() => { void refresh().then(() => { setProjectId(job.projectId, job.sessionId); setView("chat"); }).catch((reason) => setError(formatUserError(reason))); }}>{job.status === "approval_required" ? "Review approval" : "Open conversation"}</button>}
      {running && job.runId && <button type="button" className="ghost" onClick={() => { void api.stopRun(job.runId!).catch((reason) => setError(formatUserError(reason))); }}>Stop run</button>}
    </div>}
    {(error ?? state?.error ?? job?.error) && <p className="channels-error" role="alert">{error ?? state?.error ?? job?.error}</p>}
  </section>;
}
