import type { AgentLoginTerminal, TerminalDataEvent, TerminalExitEvent } from "@capsule/shared";

type Api = typeof window.capsule;

/** How much output a login terminal keeps for a view that attaches late. */
const HISTORY_LIMIT = 200_000;

export interface LoginStream {
  terminal: AgentLoginTerminal;
  /** Replays what was already printed, then forwards new output. Returns a detach. */
  attach: (write: (data: string) => void) => () => void;
  onExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  input: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  /** Ends the login program if it is still running and stops listening. Safe to call twice. */
  close: () => void;
}

/*
 * A login terminal is started by a button, not by mounting a view, so a
 * remount never runs the login twice. Output can arrive before the start call
 * returns its id, so listening begins first and everything is kept until a
 * view attaches.
 */
export async function startLoginStream(api: Api, harnessId: string, methodId: string, size: { cols: number; rows: number }): Promise<LoginStream> {
  const early: TerminalDataEvent[] = [];
  const earlyExits: TerminalExitEvent[] = [];
  let id: string | undefined;
  let history = "";
  let exit: TerminalExitEvent | undefined;
  const writers = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: TerminalExitEvent) => void>();

  const receive = (event: TerminalDataEvent) => {
    history = (history + event.data).slice(-HISTORY_LIMIT);
    for (const write of writers) write(event.data);
    if (event.sequence !== undefined) void api.terminalAcknowledge?.(event.id, event.sequence).catch(() => undefined);
  };
  const finish = (event: TerminalExitEvent) => {
    if (exit) return;
    exit = event;
    for (const listener of exitListeners) listener(event);
  };
  const offData = api.on("terminalData", (payload) => {
    const event = payload as TerminalDataEvent;
    if (id === undefined) early.push(event);
    else if (event.id === id) receive(event);
  });
  const offExit = api.on("terminalExit", (payload) => {
    const event = payload as TerminalExitEvent;
    if (id === undefined) earlyExits.push(event);
    else if (event.id === id) finish(event);
  });

  let terminal: AgentLoginTerminal;
  try {
    terminal = await api.agentLoginTerminalStart(harnessId, methodId, size);
  } catch (error) {
    offData();
    offExit();
    throw error;
  }
  id = terminal.id;
  for (const event of early) if (event.id === id) receive(event);
  for (const event of earlyExits) if (event.id === id) finish(event);

  let closed = false;
  return {
    terminal,
    attach(write) {
      if (history) write(history);
      writers.add(write);
      return () => { writers.delete(write); };
    },
    onExit(listener) {
      if (exit) listener(exit);
      exitListeners.add(listener);
      return () => { exitListeners.delete(listener); };
    },
    input(data) {
      if (!exit) void api.terminalInput(terminal.id, data).catch(() => undefined);
    },
    resize(cols, rows) {
      if (!exit) void api.terminalResize(terminal.id, cols, rows).catch(() => undefined);
    },
    close() {
      if (closed) return;
      closed = true;
      if (!exit) void api.terminalStop(terminal.id).catch(() => undefined);
      offData();
      offExit();
      writers.clear();
      exitListeners.clear();
    },
  };
}
