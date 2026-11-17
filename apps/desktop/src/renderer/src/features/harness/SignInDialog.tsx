import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cliLoginArgv, sanitizeUntrusted, type AgentSignInMethod, type AgentSignInOptions, type HarnessStatus } from "@capsule/shared";
import { useModalFocus } from "../../lib/modal-focus";
import { formatUserError } from "../../lib/errors";
import { requestTerminalCommand } from "../../lib/terminal-requests";
import { useWorkspace } from "../../lib/workspace";
import { CheckIcon, RefreshIcon, XIcon } from "../shell/icons";
import { displayCommand } from "./agent-store-model";
import { LoginTerminal } from "./LoginTerminal";
import { startLoginStream, type LoginStream } from "./login-stream";
import "./agent-store.css";

type AgentMethod = Extract<AgentSignInMethod, { kind: "agent" }>;
type CommandMethod = Extract<AgentSignInMethod, { kind: "terminal" | "cli" }>;

/** Where the dialog is. Each phase carries exactly what its panel needs. */
type Phase =
  | { at: "loading" }
  | { at: "choose"; note?: string }
  | { at: "waiting"; method: AgentMethod }
  | { at: "review"; method: CommandMethod }
  | { at: "starting"; method: CommandMethod }
  | { at: "running"; method: CommandMethod; stream: LoginStream; exit?: { code: number; error?: string } }
  | { at: "signed-in" }
  | { at: "failed"; error: string; method?: AgentSignInMethod };

/** The re-check that can run beside any phase: "I'm signed in", or after a login exits cleanly. */
type Check = "idle" | "checking" | "still-signed-out" | { error: string };

/** Agent-supplied text on one line, cut to `max` characters with a plain ellipsis. */
function label(text: string, max: number): string {
  const clean = sanitizeUntrusted(text, { singleLine: true });
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function commandEnv(method: CommandMethod): Array<[string, string]> {
  return method.kind === "terminal" ? Object.entries(method.env ?? {}).map(([key, value]) => [label(key, 64), label(value, 200)]) : [];
}

/**
 * Signs an agent in from inside Capsule. The agent's own methods come first;
 * a method that runs a command shows that exact command before anything runs,
 * then runs it in a terminal here. Every path ends in the same re-check.
 */
export function SignInDialog({ harness, onClose }: { harness: HarnessStatus; onClose: () => void }) {
  const { api, refresh, setTerminalOpen } = useWorkspace();
  const dialog = useRef<HTMLDivElement>(null);
  const [options, setOptions] = useState<AgentSignInOptions>();
  const [phase, setPhase] = useState<Phase>({ at: "loading" });
  const [check, setCheck] = useState<Check>("idle");
  const [signingOut, setSigningOut] = useState(false);
  const stream = useRef<LoginStream>(undefined);
  const attempt = useRef(0);
  const mounted = useRef(true);
  const direct = harness.runtimeRoute === "direct";
  const writable = api.isDesktop !== false;

  useModalFocus(dialog, true, onClose);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stream.current?.close();
    };
  }, []);

  useEffect(() => {
    let current = true;
    const hintArgv = cliLoginArgv(harness.loginHint);
    const fallback: AgentSignInMethod[] = hintArgv ? [{ kind: "cli", id: "cli-login", name: "Sign in from the command line", argv: hintArgv }] : [];
    void api.agentSignInOptions(harness.id)
      .then((loaded) => { if (current) { setOptions(loaded); setPhase({ at: "choose" }); } })
      .catch((error) => {
        if (!current) return;
        setOptions({ harnessId: harness.id, methods: fallback, canSignOut: false, error: formatUserError(error) });
        setPhase({ at: "choose" });
      });
    return () => { current = false; };
  }, [api, harness.id, harness.loginHint]);

  const closeStream = () => {
    stream.current?.close();
    stream.current = undefined;
  };

  const recheck = useCallback(async () => {
    setCheck("checking");
    try {
      const report = await api.doctorHarness(harness.id);
      await refresh().catch(() => undefined);
      if (!mounted.current) return;
      if (report.ready) {
        setCheck("idle");
        setPhase({ at: "signed-in" });
      } else setCheck("still-signed-out");
    } catch (error) {
      if (mounted.current) setCheck({ error: formatUserError(error) });
    }
  }, [api, harness.id, refresh]);

  const authenticate = async (method: AgentMethod) => {
    const token = ++attempt.current;
    setCheck("idle");
    setPhase({ at: "waiting", method });
    try {
      await api.agentAuthenticate(harness.id, method.id);
      if (mounted.current && token === attempt.current) await recheck();
    } catch (error) {
      if (mounted.current && token === attempt.current) setPhase({ at: "failed", error: formatUserError(error), method });
    }
  };

  const run = async (method: CommandMethod) => {
    closeStream();
    const token = ++attempt.current;
    setCheck("idle");
    setPhase({ at: "starting", method });
    try {
      const started = await startLoginStream(api, harness.id, method.id, { cols: 80, rows: 16 });
      if (!mounted.current || token !== attempt.current) { started.close(); return; }
      stream.current = started;
      setPhase({ at: "running", method, stream: started });
      started.onExit((event) => {
        if (!mounted.current || stream.current !== started) return;
        setPhase((current) => current.at === "running" && current.stream === started ? { ...current, exit: { code: event.code, error: event.error } } : current);
        if (event.code === 0) void recheck();
      });
    } catch (error) {
      if (mounted.current && token === attempt.current) setPhase({ at: "failed", error: formatUserError(error), method });
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api.agentSignOut(harness.id);
      await api.doctorHarness(harness.id).catch(() => undefined);
      await refresh().catch(() => undefined);
      if (mounted.current) { setCheck("idle"); setPhase({ at: "choose", note: `Signed out of ${harness.name}.` }); }
    } catch (error) {
      if (mounted.current) setPhase({ at: "failed", error: formatUserError(error) });
    } finally {
      if (mounted.current) setSigningOut(false);
    }
  };

  const back = () => {
    attempt.current += 1;
    closeStream();
    setCheck("idle");
    setPhase({ at: "choose" });
  };

  const methods = options?.methods ?? [];
  const subtitle = phase.at === "signed-in"
    ? `${harness.name} is ready for a turn.`
    : phase.at === "review" || phase.at === "starting" || phase.at === "running"
      ? "This runs in a terminal inside Capsule. Nothing runs until you press Run."
      : `${harness.name} keeps its own sign-in. Choose how to sign in.`;

  const body = (() => {
    switch (phase.at) {
      case "loading":
        return <p className="sign-in-status"><RefreshIcon size={14} className="spinning" aria-hidden />Asking {harness.name} how it signs in…</p>;
      case "choose":
        return <>
          {phase.note ? <p className="sign-in-status" data-tone="success"><CheckIcon size={14} aria-hidden />{phase.note}</p> : null}
          {options?.error ? <p className="sign-in-status" title={options.error}>{methods.length
            ? `${harness.name} did not list its own sign-in methods, so only its command-line login is offered.`
            : `Capsule couldn't read how ${harness.name} signs in: ${label(options.error, 160)}`}</p> : null}
          {methods.length ? <ul className="sign-in-methods">
            {methods.map((method) => {
              const name = label(method.name, 80) || "Sign in";
              const detail = method.kind === "agent"
                ? direct ? method.description && label(method.description, 160) : "Only when Capsule runs this agent itself, not through the Gateway."
                : method.kind === "terminal" ? method.description && label(method.description, 160) : displayCommand(method.argv);
              return <li className="sign-in-method" key={`${method.kind}:${method.id}`}>
                <span className="sign-in-method-copy">
                  <b title={name}>{name}</b>
                  {detail ? <small title={detail}>{detail}</small> : null}
                </span>
                {!writable ? null : method.kind === "agent"
                  ? <button type="button" className="send" disabled={!direct} onClick={() => void authenticate(method)}>Sign in</button>
                  : <button type="button" className="chip" onClick={() => { setCheck("idle"); setPhase({ at: "review", method }); }}>Continue</button>}
              </li>;
            })}
          </ul> : null}
        </>;
      case "waiting":
        return <p className="sign-in-status" role="status"><RefreshIcon size={14} className="spinning" aria-hidden />Finish signing in in your browser.</p>;
      case "review":
      case "starting":
        return <pre className="sign-in-command" aria-label="Command that will run">
          {commandEnv(phase.method).map(([key, value]) => <span className="sign-in-env" key={key}>{`${key}=${value}\n`}</span>)}
          {displayCommand(phase.method.argv)}
        </pre>;
      case "running":
        return <>
          <LoginTerminal stream={phase.stream} label={`${harness.name} sign-in terminal`} />
          {phase.exit && phase.exit.code !== 0
            ? <p className="sign-in-status" data-tone="error" role="alert">{phase.exit.error ? label(phase.exit.error, 200) : `The sign-in command stopped with exit code ${phase.exit.code}.`}</p>
            : phase.exit ? null : <p className="sign-in-status">Type in the terminal if the command asks for anything.</p>}
        </>;
      case "signed-in":
        return <p className="sign-in-status" data-tone="success" role="status"><CheckIcon size={14} aria-hidden />Signed in.</p>;
      case "failed":
        return <p className="sign-in-status" data-tone="error" role="alert" title={phase.error}>{label(phase.error, 240)}</p>;
    }
  })();

  const checkLine = check === "checking"
    ? <p className="sign-in-status" role="status"><RefreshIcon size={14} className="spinning" aria-hidden />Checking…</p>
    : check === "still-signed-out"
      ? <p className="sign-in-status" role="status">Capsule still sees {harness.name} as signed out.</p>
      : typeof check === "object" ? <p className="sign-in-status" data-tone="error" role="alert">{check.error}</p> : null;

  const canRecheck = writable && phase.at !== "loading" && phase.at !== "signed-in";
  const retry = phase.at === "failed" && phase.method
    ? phase.method.kind === "agent" ? () => void authenticate(phase.method as AgentMethod) : () => setPhase({ at: "review", method: phase.method as CommandMethod })
    : phase.at === "running" && phase.exit && phase.exit.code !== 0 ? () => setPhase({ at: "review", method: phase.method }) : undefined;
  const failedCommand = phase.at === "failed" && phase.method && phase.method.kind !== "agent" ? displayCommand(phase.method.argv) : undefined;

  return createPortal(
    <div className="palette-backdrop center" onClick={onClose}>
      <div className="dialog sign-in-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="sign-in-title" tabIndex={-1}
        onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h3 id="sign-in-title">{phase.at === "signed-in" ? `${harness.name} is signed in` : `Sign in to ${harness.name}`}</h3>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}><XIcon size={14} /></button>
        </div>
        {body}
        {checkLine}
        <div className="sign-in-footer">
          {options?.canSignOut && writable && phase.at === "choose"
            ? <button type="button" className="ghost sign-in-footer-start" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? "Signing out…" : "Sign out"}</button>
            : null}
          {phase.at === "waiting" || phase.at === "review" || phase.at === "starting" || phase.at === "running" || phase.at === "failed"
            ? <button type="button" className="ghost" onClick={back}>{phase.at === "waiting" ? "Cancel" : "Back"}</button>
            : null}
          {failedCommand ? <button type="button" className="chip" title={`Opens the terminal with ${failedCommand} typed in. Press Return to run it.`}
            onClick={() => { requestTerminalCommand({ kind: "type", command: failedCommand }); setTerminalOpen(true); onClose(); }}>Type it in the terminal</button> : null}
          {retry ? <button type="button" className="chip" onClick={retry}>Try again</button> : null}
          {canRecheck ? <button type="button" className={phase.at === "choose" && !methods.length ? "send" : "chip"} disabled={check === "checking"} onClick={() => void recheck()}>I'm signed in</button> : null}
          {phase.at === "review" || phase.at === "starting"
            ? <button type="button" className="send" disabled={phase.at === "starting"} onClick={() => void run(phase.method)}>{phase.at === "starting" ? "Starting…" : "Run"}</button>
            : null}
          {phase.at === "signed-in" ? <button type="button" className="send" onClick={onClose}>Done</button> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
