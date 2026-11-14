import {
  formatChord,
  formatChordSequence,
  parseChordSequence,
  parseKeymapAction,
  type ChordSequence,
  type DefaultBinding,
  type KeybindingEntry,
  type KeymapContext,
  type KeymapProblem,
} from "./keymap.js";

/**
 * A keyboard command the renderer owns. This table is the defaults for
 * keybindings.json, the Shortcuts list and the dispatch table at once, so a
 * binding is described exactly once.
 */
export interface KeyCommand {
  id: string;
  label: string;
  context: KeymapContext;
  /** keybindings.json spelling. `cmd` is ⌘ on macOS and Control elsewhere. */
  keys: string;
  /** Declared by the application menu, which sees the key before the page does. */
  menuOwned?: boolean;
}

export const KEY_COMMANDS: readonly KeyCommand[] = [
  { id: "palette", label: "Command palette", context: "global", keys: "cmd+k", menuOwned: true },
  { id: "new-conversation", label: "New conversation", context: "global", keys: "cmd+n", menuOwned: true },
  { id: "open-folder", label: "Open folder", context: "global", keys: "cmd+o", menuOwned: true },
  { id: "open-files", label: "Open files", context: "global", keys: "cmd+shift+o", menuOwned: true },
  { id: "settings", label: "Settings", context: "global", keys: "cmd+,", menuOwned: true },
  { id: "search-files", label: "Search files", context: "global", keys: "cmd+p" },
  { id: "search-in-files", label: "Search in files", context: "global", keys: "cmd+shift+f" },
  { id: "toggle-sidebar", label: "Toggle sidebar", context: "global", keys: "cmd+b" },
  { id: "toggle-inspector", label: "Toggle panel", context: "global", keys: "cmd+\\" },
  { id: "toggle-terminal", label: "Toggle terminal", context: "global", keys: "cmd+j" },
  { id: "history-back", label: "Back", context: "global", keys: "cmd+[" },
  { id: "history-forward", label: "Forward", context: "global", keys: "cmd+]" },
  { id: "find-in-thread", label: "Find in conversation", context: "global", keys: "cmd+f" },
  { id: "open-review", label: "Open Review", context: "global", keys: "cmd+shift+d" },
  { id: "open-browser", label: "Open Browser", context: "global", keys: "cmd+shift+b" },
  // ⌃Tab: `cmd` matches Control as well as ⌘, and ⌘Tab never reaches the app.
  { id: "next-conversation", label: "Next conversation", context: "global", keys: "cmd+tab" },
  { id: "previous-conversation", label: "Previous conversation", context: "global", keys: "cmd+shift+tab" },
  { id: "show-shortcuts", label: "Keyboard shortcuts", context: "global", keys: "cmd+/" },
  { id: "open-mode", label: "Choose mode", context: "global", keys: "cmd+shift+m" },
  { id: "open-model", label: "Choose model", context: "global", keys: "cmd+shift+i" },
  { id: "open-effort", label: "Choose effort", context: "global", keys: "cmd+shift+e" },
  { id: "clear-backdrop", label: "Clear backdrop", context: "global", keys: "" },
];

/**
 * Accelerators the application menu declares, its standard roles included
 * (close, quit, hide, minimize, reload and editing), so a binding to one of
 * them can be reported as never firing.
 */
export const MENU_OWNED_KEYS: readonly string[] = [
  "cmd+k", "cmd+n", "cmd+o", "cmd+shift+o", "cmd+,", "cmd+shift+n", "cmd+shift+s", "cmd+shift+r",
  "cmd+w", "cmd+q", "cmd+h", "cmd+alt+h", "cmd+m", "cmd+r", "cmd+alt+i", "ctrl+cmd+f",
  "cmd+z", "cmd+shift+z", "cmd+x", "cmd+c", "cmd+v", "cmd+a",
];

const MENU_FIRST_CHORDS = new Set(
  MENU_OWNED_KEYS.map((keys) => {
    const parsed = parseChordSequence(keys);
    return parsed.ok ? formatChord(parsed.sequence[0]!) : keys;
  }),
);

/** Whether the application menu takes this sequence's first key, so the binding never fires. */
export function takenByMenu(sequence: ChordSequence): boolean {
  return sequence.length > 0 && MENU_FIRST_CHORDS.has(formatChord(sequence[0]!));
}

export function keyCommand(id: string): KeyCommand | undefined {
  return KEY_COMMANDS.find((command) => command.id === id);
}

/** The table as `resolveKeymap` defaults. Menu-owned commands and commands with no keys are left out. */
export function defaultBindings(): DefaultBinding[] {
  return KEY_COMMANDS.flatMap((command) => {
    if (command.menuOwned || !command.keys) return [];
    const parsed = parseChordSequence(command.keys);
    return parsed.ok ? [{ id: command.id, context: command.context, sequence: parsed.sequence }] : [];
  });
}

/** Where an entry sits, in the doctor's words. */
export function keybindingLocator(entry: Pick<KeybindingEntry, "context" | "sequence">): string {
  return `${entry.context} "${formatChordSequence(entry.sequence)}"`;
}

/**
 * Entries that parse but cannot do what they say: rebinding a key the menu
 * takes first, an action no one knows, or a command or profile that does not
 * exist.
 */
export function keybindingWarnings(entries: readonly KeybindingEntry[], known: { commands?: readonly string[]; profiles?: readonly string[] } = {}): KeymapProblem[] {
  const problems: KeymapProblem[] = [];
  for (const entry of entries) {
    const key = keybindingLocator(entry);
    if (takenByMenu(entry.sequence)) {
      problems.push({ key, message: `${formatChord(entry.sequence[0]!)} belongs to the application menu, which takes it before Capsule can. This binding never fires.` });
      continue;
    }
    if (entry.action === null) continue;
    const { namespace, name } = parseKeymapAction(entry.action);
    if (namespace === undefined) {
      const command = keyCommand(name);
      if (!command) problems.push({ key, message: `"${name}" is not a Capsule shortcut action.` });
      else if (command.menuOwned) problems.push({ key, message: `"${name}" is fixed by the application menu and cannot be rebound.` });
    } else if (namespace === "profile" && known.profiles && !known.profiles.includes(name)) {
      problems.push({ key, message: `There is no profile named ${name}.` });
    } else if (namespace === "command" && known.commands && !known.commands.includes(name)) {
      problems.push({ key, message: `There is no /${name} command.` });
    }
  }
  return problems;
}
