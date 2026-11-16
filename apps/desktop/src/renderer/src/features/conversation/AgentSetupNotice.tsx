import { useEffect, useRef, useState } from "react";
import type { HarnessStatus } from "@capsule/shared";
import "./agent-setup.css";
import type { AgentSetupNotice as Notice } from "../../lib/harness-preflight";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { AgentStoreControls, useCanInstall } from "../harness/AgentStoreControls";
import { SignInDialog } from "../harness/SignInDialog";
import { RefreshIcon } from "../shell/icons";

/**
 * The picked agent cannot take a turn yet. One quiet line says why and how to
 * fix it: Install when Capsule can install the agent, Sign in when it is
 * signed out, and a way to look again either way.
 */
export function AgentSetupNotice({ notice, harness, canAct }: { notice: Notice; harness: HarnessStatus; canAct: boolean }) {
  const { api, refresh } = useWorkspace();
  const [check, setCheck] = useState<"idle" | "checking" | "unchanged" | { error: string }>("idle");
  const [signingIn, setSigningIn] = useState(false);
  const installable = useCanInstall(harness.id) && notice.kind === "install";
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => { setCheck("idle"); setSigningIn(false); }, [harness.id, notice.kind]);

  const checkAgain = async () => {
    setCheck("checking");
    try {
      const report = await api.doctorHarness(harness.id);
      await refresh();
      if (mounted.current) setCheck(report.ready ? "idle" : "unchanged");
    } catch (error) {
      if (mounted.current) setCheck({ error: formatUserError(error) });
    }
  };

  const status = check === "unchanged"
    ? notice.kind === "sign-in" ? "Still signed out." : notice.kind === "install" ? "Still not found." : "Still unreadable."
    : typeof check === "object" ? check.error : undefined;
  return <div className="agent-setup" role="status" data-kind={notice.kind}>
    <span className="agent-setup-mark" aria-hidden />
    <p className="agent-setup-text">
      <strong>{notice.title}</strong>
      {notice.command
        ? <span>Run <code>{notice.command}</code>{canAct ? ", then check again." : " in a terminal on the computer running Capsule."}</span>
        : notice.detail ? <span title={notice.detail}>{notice.detail}</span> : null}
      {status ? <span className={typeof check === "object" ? "agent-setup-error" : "agent-setup-status"}>{status}</span> : null}
    </p>
    {canAct ? <div className="agent-setup-actions">
      {installable ? <AgentStoreControls harnessId={harness.id} name={harness.name} inline /> : null}
      {notice.kind === "sign-in" ? <button type="button" className="chip" onClick={() => setSigningIn(true)}>Sign in</button> : null}
      <button type="button" className="ghost" disabled={check === "checking"} onClick={() => void checkAgain()}>
        <RefreshIcon size={13} aria-hidden className={check === "checking" ? "spinning" : undefined} />{check === "checking" ? "Checking…" : "Check again"}
      </button>
    </div> : null}
    {signingIn ? <SignInDialog harness={harness} onClose={() => setSigningIn(false)} /> : null}
  </div>;
}
