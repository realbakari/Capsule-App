import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HarnessStatus, SuggestedProject } from "@capsule/shared";
import { harnessReadinessLabel, isFeaturedHarness } from "../../lib/harness";
import { useModalFocus } from "../../lib/modal-focus";
import { formatProjectRoot } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { AgentStoreControls } from "../harness/AgentStoreControls";
import { useAgentStore } from "../harness/agent-store";
import { SignInDialog } from "../harness/SignInDialog";
import { AgentGlyph } from "../shell/AgentGlyph";
import { CloneRepositoryDialog } from "../shell/CloneRepositoryDialog";
import { CheckIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, RefreshIcon } from "../shell/icons";
import { agentIsReady, firstRunAgent, onFirstRunRequest, shouldOpenFirstRun, updateSetupMarks } from "./setup-progress";
import "./onboarding.css";

/** Opens first run for a new profile, and whenever the palette or the checklist asks. */
export function FirstRunHost() {
  const { api, settings, projects } = useWorkspace();
  const desktop = api.isDesktop !== false;
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !shouldOpenFirstRun({ desktop, settings, projectCount: projects.length })) return;
    opened.current = true;
    setOpen(true);
  }, [desktop, settings, projects.length]);
  useEffect(() => onFirstRunRequest(() => { if (desktop) setOpen(true); }), [desktop]);
  useEffect(() => { if (open) updateSetupMarks({ pending: true }); }, [open]);
  return open ? <FirstRun onClose={() => setOpen(false)} /> : null;
}

/** Puts the caret in the new conversation's composer once it is on screen. */
function focusComposer(): void {
  let frames = 0;
  const attempt = () => {
    const field = document.querySelector<HTMLTextAreaElement>("textarea.composer-field");
    if (field) { field.focus(); return; }
    if (++frames < 30) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

/*
 * One page, not a wizard: the agent and the folder are independent, and
 * notifications already default to on, so asking about them first only
 * delayed the first message. Start needs a folder; an agent that is not ready
 * yet is finished from the conversation, where the composer says how.
 */
function FirstRun({ onClose }: { onClose: () => void }) {
  const { harnesses, projects, project, settings, updateSettings, createTask, agentId, setAgentId } = useWorkspace();
  const [signInId, setSignInId] = useState<string>();
  const [cloneOpen, setCloneOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  /* A project without a folder (the Inbox) gives an agent nowhere to work, so it is not a start. */
  const target = project?.workingDirectory ? project : projects.find((item) => item.workingDirectory);
  const start = firstRunAgent(harnesses ?? [], agentId);

  /* The composer's agent follows the ready one, so the first message reaches an agent that can answer it. */
  useEffect(() => {
    if (start && start.id !== agentId) setAgentId(start.id);
  }, [start?.id, agentId, setAgentId]);

  /* A folder picked here is the last thing asked for; Enter now starts. */
  const hadTarget = useRef(Boolean(target));
  useEffect(() => {
    if (target && !hadTarget.current) startButton.current?.focus();
    hadTarget.current = Boolean(target);
  }, [target]);

  const later = useCallback(() => {
    void updateSettings({ firstRunDone: true }).catch(() => undefined);
    onClose();
  }, [onClose, updateSettings]);
  /* A dialog opened from here owns the keyboard until it closes. */
  useModalFocus(panel, !signInId && !cloneOpen, later);

  const finish = async () => {
    updateSetupMarks({ pending: false });
    const keepAgent = start && settings?.defaultAgentId !== start.id ? { defaultAgentId: start.id } : {};
    void updateSettings({ firstRunDone: true, ...keepAgent }).catch(() => undefined);
    onClose();
    if (!target) return;
    await createTask(target.id).catch(() => undefined);
    focusComposer();
  };

  const signInHarness = (harnesses ?? []).find((item) => item.id === signInId);
  const status = !target
    ? "Choose a folder to start."
    : start
      ? `Starts with ${start.name}. You can switch in the composer.`
      : "No agent is ready yet. The conversation shows how to finish setting one up.";

  return createPortal(
    <div className="first-run-backdrop">
      <div className="first-run" ref={panel} role="dialog" aria-modal="true" aria-labelledby="first-run-title" aria-describedby="first-run-detail" tabIndex={-1}>
        <p className="first-run-eyebrow">Welcome to Capsule</p>
        <h2 id="first-run-title">Choose an agent and a folder</h2>
        <p id="first-run-detail" className="first-run-detail">Capsule drives a coding agent that runs on this computer, inside a folder you pick.</p>

        <section className="first-run-section" aria-labelledby="first-run-agents-title">
          <h3 id="first-run-agents-title">Agent</h3>
          <AgentsSection onSignIn={setSignInId} />
        </section>
        <section className="first-run-section" aria-labelledby="first-run-folder-title">
          <h3 id="first-run-folder-title">Folder</h3>
          <FolderSection target={target} onClone={() => setCloneOpen(true)} />
        </section>
        <p className="first-run-hint first-run-note">Capsule notifies you when a turn finishes or needs you. Change that in Settings, under General.</p>

        <div className="first-run-footer">
          <button type="button" className="ghost first-run-later" onClick={later}>Set up later</button>
          <span className="first-run-hint first-run-status" role="status">{status}</span>
          <button type="button" ref={startButton} className="send" disabled={!target} onClick={() => void finish()}>Start a conversation</button>
        </div>
      </div>
      {signInHarness ? <SignInDialog harness={signInHarness} onClose={() => setSignInId(undefined)} /> : null}
      {cloneOpen ? <CloneRepositoryDialog onClose={() => setCloneOpen(false)} /> : null}
    </div>,
    document.body,
  );
}

function AgentsSection({ onSignIn }: { onSignIn: (harnessId: string) => void }) {
  const { api, harnesses, refresh } = useWorkspace();
  const [checking, setChecking] = useState(false);
  const all = harnesses ?? [];
  const featured = all.filter(isFeaturedHarness);
  const shown = featured.length ? featured : all.slice(0, 4);
  /* An agent installed in a terminal outside Capsule shows up only after a fresh look. */
  const checkAgain = async () => {
    setChecking(true);
    try {
      await Promise.all(shown.filter((item) => !agentIsReady(item)).map((item) => api.doctorHarness(item.id).catch(() => undefined)));
      await refresh();
    } finally {
      setChecking(false);
    }
  };
  if (!shown.length) return <p className="first-run-hint">Looking for agents…</p>;
  return <>
    <ul className="first-run-agents">
      {shown.map((harness) => <FirstRunAgent key={harness.id} harness={harness} onSignIn={() => onSignIn(harness.id)} />)}
    </ul>
    <button type="button" className="ghost first-run-recheck" disabled={checking} onClick={() => void checkAgain()}>
      <RefreshIcon size={13} aria-hidden className={checking ? "spinning" : undefined} />{checking ? "Checking…" : "Check again"}
    </button>
  </>;
}

function FirstRunAgent({ harness, onSignIn }: { harness: HarnessStatus; onSignIn: () => void }) {
  const store = useAgentStore();
  const row = store.row(harness.id);
  const ready = agentIsReady(harness);
  const signedOut = harness.readiness === "needs_login" && harness.loginState !== "config_invalid";
  const missing = harness.readiness === "missing_cli";
  const storeCanHelp = row.kind === "offer" || row.kind === "busy" || row.kind === "failed";
  return <li className="first-run-agent" data-ready={ready || undefined}>
    <AgentGlyph id={harness.id} name={harness.name} size={22} />
    <span className="first-run-agent-copy">
      <b>{harness.name}</b>
      <small>{ready ? harness.description : harnessReadinessLabel(harness.readiness)}</small>
    </span>
    <span className="first-run-agent-action">
      {ready
        ? <span className="first-run-ready"><CheckIcon size={12} aria-hidden />Ready</span>
        : signedOut
          ? <button type="button" className="chip" onClick={onSignIn}>Sign in</button>
          : missing && storeCanHelp
            ? <AgentStoreControls harnessId={harness.id} name={harness.name} inline />
            : missing
              ? <>
                {row.kind === "unavailable" ? <span className="first-run-agent-note" title={row.reason}>{row.reason}</span> : null}
                <a className="chip" href={harness.installUrl} target="_blank" rel="noreferrer">How to install</a>
              </>
              : null}
    </span>
  </li>;
}

function FolderSection({ target, onClone }: { target?: { id: string; name: string; workingDirectory?: string }; onClone: () => void }) {
  const { api, createProjectFromFolder } = useWorkspace();
  if (target) {
    return <div className="first-run-folder">
      <FolderIcon size={16} aria-hidden />
      <span className="first-run-agent-copy">
        <b>{target.name}</b>
        <small className="mono">{formatProjectRoot(target.workingDirectory, { home: api.homeDir })}</small>
      </span>
      <button type="button" className="ghost first-run-change" onClick={() => void createProjectFromFolder()}>Choose another</button>
    </div>;
  }
  return <>
    <SuggestedProjects />
    <div className="first-run-choices">
      <button type="button" className="first-run-choice" onClick={() => void createProjectFromFolder()}>
        <FolderOpenIcon size={18} aria-hidden />
        <span><b>Open a folder</b><small>A project already on this computer</small></span>
      </button>
      <button type="button" className="first-run-choice" onClick={onClone}>
        <GitBranchIcon size={18} aria-hidden />
        <span><b>Clone a repository</b><small>From a Git URL or GitHub</small></span>
      </button>
    </div>
  </>;
}

/* What the importer brings with a project: its recent conversations, not years of them. */
const IMPORT_WINDOW_MS = 30 * 86_400_000;
const IMPORT_LIMIT = 10;

/**
 * Folders the agents' own histories show steady recent work in, offered as
 * projects. Read from this computer only; all are chosen to begin with, and
 * one press adds them, optionally with their recent conversations.
 */
function SuggestedProjects() {
  const { api, refresh } = useWorkspace();
  const [suggestions, setSuggestions] = useState<SuggestedProject[]>([]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [bringConversations, setBringConversations] = useState(false);
  const [state, setState] = useState<"idle" | "adding" | { error: string }>("idle");
  useEffect(() => {
    if (api.isDesktop === false || typeof api.suggestProjects !== "function") return;
    let live = true;
    void api.suggestProjects().then((list) => {
      if (!live) return;
      setSuggestions(list);
      setChosen(new Set(list.map((item) => item.path)));
    }, () => undefined);
    return () => { live = false; };
  }, [api]);
  if (!suggestions.length) return null;

  const toggle = (folder: string) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(folder)) next.delete(folder);
    else next.add(folder);
    return next;
  });
  const add = async () => {
    setState("adding");
    try {
      for (const item of suggestions.filter((entry) => chosen.has(entry.path))) {
        const created = await api.createProject({ name: item.name, workingDirectory: item.path }) as { id: string };
        if (!bringConversations) continue;
        const since = Date.now() - IMPORT_WINDOW_MS;
        const listing = await api.listImportableSessions(created.id);
        for (const session of listing.sessions.filter((entry) => !entry.importedAs && Date.parse(entry.lastActivity) >= since).slice(0, IMPORT_LIMIT)) {
          await api.importSession({ projectId: created.id, agent: session.agent, nativeSessionId: session.nativeSessionId });
        }
      }
      await refresh();
      setState("idle");
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : String(error) });
    }
  };
  const count = chosen.size;
  return <div className="first-run-suggestions">
    <p className="first-run-hint">Folders with recent agent sessions on this computer</p>
    <ul>
      {suggestions.map((item) => <li key={item.path}>
        <label className="first-run-suggestion">
          <input type="checkbox" checked={chosen.has(item.path)} onChange={() => toggle(item.path)} />
          <span className="first-run-agent-copy">
            <b>{item.name}</b>
            <small className="mono" title={item.path}>{formatProjectRoot(item.path, { home: api.homeDir })} · {item.sessions} sessions in 30 days</small>
          </span>
        </label>
      </li>)}
    </ul>
    <div className="first-run-suggestions-footer">
      <label className="first-run-suggestion-option">
        <input type="checkbox" checked={bringConversations} onChange={(event) => setBringConversations(event.target.checked)} />
        Bring in their recent conversations
      </label>
      <button type="button" className="chip" disabled={!count || state === "adding"} onClick={() => void add()}>
        {state === "adding" ? "Adding…" : `Add ${count} ${count === 1 ? "project" : "projects"}`}
      </button>
    </div>
    {typeof state === "object" ? <p className="first-run-hint first-run-error" role="alert">{state.error}</p> : null}
  </div>;
}
