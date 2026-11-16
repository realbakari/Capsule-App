import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HarnessStatus } from "@capsule/shared";
import { harnessReadinessLabel, isFeaturedHarness } from "../../lib/harness";
import { useModalFocus } from "../../lib/modal-focus";
import { formatProjectRoot } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { AgentStoreControls } from "../harness/AgentStoreControls";
import { useAgentStore } from "../harness/agent-store";
import { SignInDialog } from "../harness/SignInDialog";
import { NotificationsCard } from "../settings/ConfigurationSettings";
import { AgentGlyph } from "../shell/AgentGlyph";
import { CloneRepositoryDialog } from "../shell/CloneRepositoryDialog";
import { CheckIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, RefreshIcon } from "../shell/icons";
import { agentIsReady, onFirstRunRequest, shouldOpenFirstRun, updateSetupMarks, type SetupItemId } from "./setup-progress";
import "./onboarding.css";

type Step = "agents" | "folder" | "notifications";

const STEPS: ReadonlyArray<{ id: Step; title: string; detail: string }> = [
  { id: "agents", title: "Set up an agent", detail: "Capsule drives a coding agent that runs on this computer. Install one and sign in, and it is ready." },
  { id: "folder", title: "Choose a folder", detail: "The agent works inside a folder you pick. Open one on this computer or clone a repository." },
  { id: "notifications", title: "Choose notifications", detail: "Decide when Capsule should get your attention while it is in the background. Settings can change this later." },
];

const STEP_FOR_ITEM: Record<SetupItemId, Step> = { agent: "agents", folder: "folder", notifications: "notifications" };

/** Opens first run for a new profile, and whenever the palette or the checklist asks. */
export function FirstRunHost() {
  const { api, settings, projects } = useWorkspace();
  const desktop = api.isDesktop !== false;
  const [open, setOpen] = useState<Step>();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !shouldOpenFirstRun({ desktop, settings, projectCount: projects.length })) return;
    opened.current = true;
    setOpen("agents");
  }, [desktop, settings, projects.length]);
  useEffect(() => onFirstRunRequest((at) => { if (desktop) setOpen(at ? STEP_FOR_ITEM[at] : "agents"); }), [desktop]);
  useEffect(() => { if (open) updateSetupMarks({ pending: true }); }, [open]);
  return open ? <FirstRun key={open} initialStep={open} onClose={() => setOpen(undefined)} /> : null;
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

function FirstRun({ initialStep, onClose }: { initialStep: Step; onClose: () => void }) {
  const { harnesses, projects, project, projectId, settings, updateSettings, createTask } = useWorkspace();
  const [step, setStep] = useState<Step>(initialStep);
  const [signInId, setSignInId] = useState<string>();
  const [cloneOpen, setCloneOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const index = STEPS.findIndex((item) => item.id === step);
  const current = STEPS[index]!;
  const anyReady = (harnesses ?? []).some(agentIsReady);
  const target = project ?? projects.find((item) => item.id === projectId) ?? projects[0];

  const later = useCallback(() => {
    void updateSettings({ firstRunDone: true }).catch(() => undefined);
    onClose();
  }, [onClose, updateSettings]);
  /* A dialog opened from a step owns the keyboard until it closes. */
  useModalFocus(panel, !signInId && !cloneOpen, later);

  const finish = async () => {
    updateSetupMarks({ pending: false, notificationsChosen: true });
    void updateSettings({ firstRunDone: true }).catch(() => undefined);
    onClose();
    if (!target) return;
    await createTask(target.id).catch(() => undefined);
    focusComposer();
  };

  const canContinue = step === "agents" ? anyReady : step === "folder" ? Boolean(target) : true;
  const signInHarness = (harnesses ?? []).find((item) => item.id === signInId);

  return createPortal(
    <div className="first-run-backdrop">
      <div className="first-run" ref={panel} role="dialog" aria-modal="true" aria-labelledby="first-run-title" aria-describedby="first-run-detail" tabIndex={-1}>
        <div className="first-run-progress" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
          {STEPS.map((item, position) => <span key={item.id} data-state={position < index ? "done" : position === index ? "current" : "todo"} />)}
        </div>
        <p className="first-run-eyebrow">{index === 0 ? "Welcome to Capsule" : `Step ${index + 1} of ${STEPS.length}`}</p>
        <h2 id="first-run-title">{current.title}</h2>
        <p id="first-run-detail" className="first-run-detail">{current.detail}</p>

        <div className="first-run-body">
          {step === "agents" ? <AgentsStep onSignIn={setSignInId} /> : null}
          {step === "folder" ? <FolderStep target={target} onClone={() => setCloneOpen(true)} /> : null}
          {step === "notifications" ? settings
            ? <NotificationsCard settings={settings} onPatch={(next) => { updateSetupMarks({ notificationsChosen: true }); void updateSettings(next); }} />
            : <p className="first-run-hint">Loading settings…</p> : null}
        </div>

        <div className="first-run-footer">
          <button type="button" className="ghost first-run-later" onClick={later}>Set up later</button>
          {!canContinue ? <span className="first-run-hint">{step === "agents" ? "Continue once one agent is ready." : "Continue once a folder is added."}</span> : null}
          {index > 0 ? <button type="button" className="ghost" onClick={() => setStep(STEPS[index - 1]!.id)}>Back</button> : null}
          {step === "notifications"
            ? <button type="button" className="send" disabled={!target} onClick={() => void finish()}>Start a conversation</button>
            : <button type="button" className="send" disabled={!canContinue} onClick={() => setStep(STEPS[index + 1]!.id)}>Continue</button>}
        </div>
      </div>
      {signInHarness ? <SignInDialog harness={signInHarness} onClose={() => setSignInId(undefined)} /> : null}
      {cloneOpen ? <CloneRepositoryDialog onClose={() => setCloneOpen(false)} /> : null}
    </div>,
    document.body,
  );
}

function AgentsStep({ onSignIn }: { onSignIn: (harnessId: string) => void }) {
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

function FolderStep({ target, onClone }: { target?: { id: string; name: string; workingDirectory?: string }; onClone: () => void }) {
  const { api, createProjectFromFolder } = useWorkspace();
  if (target) {
    return <div className="first-run-folder">
      <FolderIcon size={16} aria-hidden />
      <span className="first-run-agent-copy">
        <b>{target.name}</b>
        <small className="mono">{formatProjectRoot(target.workingDirectory, { home: api.homeDir, fallback: "No folder chosen" })}</small>
      </span>
      <span className="first-run-ready"><CheckIcon size={12} aria-hidden />Added</span>
    </div>;
  }
  return <div className="first-run-choices">
    <button type="button" className="first-run-choice" onClick={() => void createProjectFromFolder()}>
      <FolderOpenIcon size={18} aria-hidden />
      <span><b>Open a folder</b><small>A project already on this computer</small></span>
    </button>
    <button type="button" className="first-run-choice" onClick={onClone}>
      <GitBranchIcon size={18} aria-hidden />
      <span><b>Clone a repository</b><small>From a Git URL or GitHub</small></span>
    </button>
  </div>;
}
