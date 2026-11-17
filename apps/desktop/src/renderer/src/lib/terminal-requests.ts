/*
 * A way for a control outside the terminal dock to hand it work. Only the
 * dock that is on screen takes a request; one that opens because of the
 * request picks it up from `takeTerminalCommand` once its first shell exists.
 */

/** The tab a project action runs in: found again by `key`, named `label`. */
export interface ActionTab {
  key: string;
  label: string;
}

export type TerminalRequest =
  /** Typed into a fresh shell and left for the person to read and run. */
  | { kind: "type"; command: string }
  /** A project action: run at once, in the action's own tab. */
  | { kind: "run"; command: string; tab: ActionTab };

type Listener = (request: TerminalRequest) => boolean;

let pending: TerminalRequest | undefined;
const listeners = new Set<Listener>();

export function requestTerminalCommand(request: TerminalRequest): void {
  for (const listener of listeners) if (listener(request)) return;
  pending = request;
}

export function takeTerminalCommand(): TerminalRequest | undefined {
  const request = pending;
  pending = undefined;
  return request;
}

export function onTerminalCommand(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/*
 * What the shell receives. An action clears whatever was half-typed at the
 * prompt (Control-U) so it never runs glued to someone else's text.
 */
export function terminalInput(request: TerminalRequest): string {
  return request.kind === "run" ? `\x15${request.command}\r` : request.command;
}

export interface DockTab {
  id: string;
  /** The `ActionTab.key` of the action that opened it. */
  action?: string;
  /** Set once the shell has ended; its tab stays only so the output can be read. */
  exitCode?: number;
  /** Where the shell last reported it is, when it reports that at all. */
  folder?: string;
}

/*
 * The tabs an action may run in again, best first: ones it opened before,
 * whose shell is alive and still in the dock's folder, the tab on screen
 * first. Whether a shell is idle is asked of it afterwards, in this order.
 */
export function actionTabCandidates(tabs: readonly DockTab[], key: string, activeId: string | undefined, cwd: string): string[] {
  const usable = tabs.filter((tab) => tab.action === key && tab.exitCode === undefined && (tab.folder === undefined || tab.folder === cwd));
  return [...usable.filter((tab) => tab.id === activeId), ...usable.filter((tab) => tab.id !== activeId)].map((tab) => tab.id);
}

/** The action's name, or "dev 2" when a busy "dev" tab already has it. */
export function actionTabLabel(name: string, used: readonly string[]): string {
  if (!used.includes(name)) return name;
  let number = 2;
  while (used.includes(`${name} ${number}`)) number++;
  return `${name} ${number}`;
}
