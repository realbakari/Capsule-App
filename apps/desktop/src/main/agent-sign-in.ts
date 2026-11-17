import { IPC_CHANNELS, isHarnessId, type AgentLoginTerminal, type AgentSignInOptions, type HarnessId } from "@capsule/shared";
import type { CapsuleEngine } from "@capsule/core";
import { launchExtras } from "@capsule/harness";

/*
 * Signing an agent in: lists its methods, runs ACP authenticate/logout
 * through the engine, and starts login terminals whose argv main resolves
 * itself. The renderer only ever names a harness and a method id.
 */
export interface AgentSignInHost {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => void;
  engine: () => CapsuleEngine;
  /** Starts `argv` in a PTY (not a shell) and streams it on terminalData/terminalExit. */
  startLoginTerminal: (
    argv: string[],
    env: Record<string, string>,
    size: { cols?: number; rows?: number } | undefined,
    onExit: (code: number) => void,
  ) => AgentLoginTerminal;
}

/* The options the user was shown are the ones a Run press may start, for as long as they could still be on screen. */
const OPTIONS_TTL_MS = 10 * 60_000;

function readHarnessId(value: unknown): HarnessId {
  if (typeof value !== "string" || !isHarnessId(value)) throw new Error("Unknown agent.");
  return value;
}

function readMethodId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 256) throw new Error("Unknown sign-in method.");
  return value;
}

function readSize(value: unknown): { cols?: number; rows?: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { cols, rows } = value as { cols?: unknown; rows?: unknown };
  const dimension = (item: unknown) => Number.isSafeInteger(item) && Number(item) > 0 && Number(item) <= 1000 ? Number(item) : undefined;
  return { cols: dimension(cols), rows: dimension(rows) };
}

export function registerAgentSignIn(host: AgentSignInHost): void {
  const shown = new Map<HarnessId, { at: number; options: AgentSignInOptions }>();

  const readOptions = async (harnessId: HarnessId): Promise<AgentSignInOptions> => {
    const options = await host.engine().agentSignInOptions(harnessId);
    shown.set(harnessId, { at: Date.now(), options });
    return options;
  };

  host.handle(IPC_CHANNELS.agentSignInOptions, (harnessId) => readOptions(readHarnessId(harnessId)));
  host.handle(IPC_CHANNELS.agentAuthenticate, async (harnessId, methodId) => {
    await host.engine().agentAuthenticate(readHarnessId(harnessId), readMethodId(methodId));
  });
  host.handle(IPC_CHANNELS.agentSignOut, async (harnessId) => {
    await host.engine().agentSignOut(readHarnessId(harnessId));
  });
  host.handle(IPC_CHANNELS.agentLoginTerminalStart, async (rawHarnessId, rawMethodId, size) => {
    const harnessId = readHarnessId(rawHarnessId);
    const methodId = readMethodId(rawMethodId);
    host.engine().assertLocalCommandsAllowed();
    const cached = shown.get(harnessId);
    const options = cached && Date.now() - cached.at < OPTIONS_TTL_MS ? cached.options : await readOptions(harnessId);
    const method = options.methods.find((item) => item.id === methodId);
    if (!method) throw new Error("That sign-in method is no longer offered. Open sign-in again.");
    if (method.kind === "agent") throw new Error("This sign-in method runs inside the agent, not in a terminal.");
    /* A second account's config folder applies to its sign-in too, or the login lands on the default account. */
    const env = { ...launchExtras(harnessId).env, ...(method.kind === "terminal" ? method.env : undefined) };
    return host.startLoginTerminal(method.argv, env, readSize(size), (code) => {
      if (code === 0) host.engine().agentSignInChanged();
    });
  });
}
