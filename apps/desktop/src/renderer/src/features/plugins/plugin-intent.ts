/**
 * The palette, the library and the doctor ask the Plugins screen to start an
 * install or a validation. The screen owns the install dialog, so the request
 * waits here until it is mounted to take it.
 */
export type PluginIntent = "folder" | "zip" | "dev" | "validate";

let pending: PluginIntent | undefined;
const listeners = new Set<() => void>();

export function requestPluginIntent(intent: PluginIntent): void {
  pending = intent;
  for (const listener of listeners) listener();
}

export function takePluginIntent(): PluginIntent | undefined {
  const intent = pending;
  pending = undefined;
  return intent;
}

export function onPluginIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
