/**
 * The keyboard commands the renderer owns, and how a chord is matched.
 *
 * Shortcuts used to live in three places that could not disagree loudly: the
 * handler in workspace.tsx tested `key === "b"` inline, the application menu
 * declared its own accelerators in the main process, and Settings rendered a
 * hardcoded list that documented neither. A key could be changed in one and
 * stay wrong in the other two.
 *
 * This registry is the handler's dispatch table and the Settings list at once,
 * so a binding is described exactly once. Menu accelerators still belong to the
 * main process — they fire before the web contents sees the event — so those
 * commands are marked `menuOwned` and shown as fixed rather than pretending to
 * be editable here.
 */

export interface KeyChord {
  /** Lower-case `KeyboardEvent.key`, or the literal for punctuation. */
  key: string;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

export interface KeyCommand {
  id: string;
  label: string;
  chord: KeyChord;
  /** Declared by the application menu, so it cannot be rebound from here. */
  menuOwned?: boolean;
}

/** ⌘ on macOS, Ctrl elsewhere — one flag, matched against either. */
export const COMMANDS: KeyCommand[] = [
  { id: "palette", label: "Command palette", chord: { key: "k", meta: true }, menuOwned: true },
  { id: "new-conversation", label: "New conversation", chord: { key: "n", meta: true }, menuOwned: true },
  { id: "open-folder", label: "Open folder", chord: { key: "o", meta: true }, menuOwned: true },
  { id: "open-files", label: "Open files", chord: { key: "o", meta: true, shift: true }, menuOwned: true },
  { id: "settings", label: "Settings", chord: { key: ",", meta: true }, menuOwned: true },
  { id: "search-files", label: "Search files", chord: { key: "p", meta: true } },
  { id: "search-in-files", label: "Search in files", chord: { key: "f", meta: true, shift: true } },
  { id: "toggle-sidebar", label: "Toggle sidebar", chord: { key: "b", meta: true } },
  { id: "toggle-inspector", label: "Toggle inspector", chord: { key: "\\", meta: true } },
  { id: "toggle-terminal", label: "Toggle terminal", chord: { key: "j", meta: true } },
];

export type Keymap = Record<string, KeyChord>;

/** Parse a stored chord such as "meta+shift+f". Unknown input is ignored. */
export function parseChord(value: string): KeyChord | undefined {
  const parts = value.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean);
  const key = parts.pop();
  if (!key) return undefined;
  const chord: KeyChord = { key };
  for (const part of parts) {
    if (part === "meta" || part === "cmd") chord.meta = true;
    else if (part === "shift") chord.shift = true;
    else if (part === "alt" || part === "option") chord.alt = true;
    else if (part === "ctrl" || part === "control") chord.ctrl = true;
    else return undefined;
  }
  return chord;
}

export function formatChord(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("ctrl");
  if (chord.alt) parts.push("alt");
  if (chord.shift) parts.push("shift");
  if (chord.meta) parts.push("meta");
  parts.push(chord.key);
  return parts.join("+");
}

/** Display form, for the settings list. */
export function chordSymbols(chord: KeyChord): string[] {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("⌃");
  if (chord.alt) parts.push("⌥");
  if (chord.shift) parts.push("⇧");
  if (chord.meta) parts.push("⌘");
  parts.push(chord.key === " " ? "Space" : chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return parts;
}

/**
 * Whether an event is this chord.
 *
 * Modifiers are matched exactly in both directions: without that, ⌘B also fires
 * on ⌘⇧B, so a binding silently shadows every chord built on top of it.
 */
export function matchesChord(event: KeyboardEvent, chord: KeyChord): boolean {
  if (event.key.toLowerCase() !== chord.key.toLowerCase()) return false;
  // meta covers ⌘ on macOS and Ctrl elsewhere; a chord asking for neither must
  // not fire while one is held.
  const primary = event.metaKey || event.ctrlKey;
  if (Boolean(chord.meta) !== primary) return false;
  if (Boolean(chord.shift) !== event.shiftKey) return false;
  if (Boolean(chord.alt) !== event.altKey) return false;
  return true;
}

/** Effective chord for a command, honouring a user override. */
export function chordFor(command: KeyCommand, keymap: Keymap | undefined): KeyChord {
  return keymap?.[command.id] ?? command.chord;
}

/** The command an event triggers, or undefined. Menu-owned commands are skipped. */
export function commandForEvent(
  event: KeyboardEvent,
  keymap: Keymap | undefined,
  commands: KeyCommand[] = COMMANDS,
): KeyCommand | undefined {
  return commands.find(
    (command) => !command.menuOwned && matchesChord(event, chordFor(command, keymap)),
  );
}

/**
 * Commands that would answer to the same chord. A binding that silently steals
 * another's keys is worse than one that refuses to be set.
 */
export function conflictsFor(
  id: string,
  chord: KeyChord,
  keymap: Keymap | undefined,
  commands: KeyCommand[] = COMMANDS,
): KeyCommand[] {
  const target = formatChord(chord);
  return commands.filter(
    (command) => command.id !== id && formatChord(chordFor(command, keymap)) === target,
  );
}
