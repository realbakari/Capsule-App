/*
 * A way for a control outside the terminal dock to hand it a command, typed
 * into a fresh shell and left for the person to run. Only the dock that is on
 * screen takes it; one that opens because of the request picks it up from
 * `takeTerminalCommand` once its first shell exists.
 */
type Listener = (command: string) => boolean;

let pending: string | undefined;
const listeners = new Set<Listener>();

export function requestTerminalCommand(command: string): void {
  for (const listener of listeners) if (listener(command)) return;
  pending = command;
}

export function takeTerminalCommand(): string | undefined {
  const command = pending;
  pending = undefined;
  return command;
}

export function onTerminalCommand(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
