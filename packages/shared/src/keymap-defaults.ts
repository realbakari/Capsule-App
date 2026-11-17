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

/** Where a command sits in Settings → Shortcuts, in this order. */
export const KEY_COMMAND_GROUPS = ["General", "Go to", "Conversation", "Composer", "Workspace"] as const;

export type KeyCommandGroup = (typeof KEY_COMMAND_GROUPS)[number];

/**
 * A keyboard command the renderer owns. This table is the defaults for
 * keybindings.json, the Shortcuts list and the dispatch table at once, so a
 * binding is described exactly once.
 */
export interface KeyCommand {
  id: string;
  label: string;
  group: KeyCommandGroup;
  /** One line under the label in Settings, for a command whose name does not say enough. */
  description?: string;
  context: KeymapContext;
  /** keybindings.json spelling. `cmd` is ⌘ on macOS and Control elsewhere. */
  keys: string;
  /** Declared by the application menu, which sees the key before the page does. */
  menuOwned?: boolean;
}

export const KEY_COMMANDS: readonly KeyCommand[] = [
  { id: "palette", label: "Command palette", group: "General", context: "global", keys: "cmd+k", menuOwned: true },
  { id: "settings", label: "Settings", group: "General", context: "global", keys: "cmd+,", menuOwned: true },
  { id: "show-shortcuts", label: "Keyboard shortcuts", group: "General", description: "Every shortcut on one sheet.", context: "global", keys: "cmd+/" },
  { id: "new-conversation", label: "New conversation", group: "General", context: "global", keys: "cmd+n", menuOwned: true },
  { id: "open-folder", label: "Open folder", group: "General", context: "global", keys: "cmd+o", menuOwned: true },
  { id: "open-files", label: "Open files", group: "General", context: "global", keys: "cmd+shift+o", menuOwned: true },
  { id: "clear-backdrop", label: "Clear backdrop", group: "General", description: "Turns off the conversation backdrop, scene or image.", context: "global", keys: "" },
  { id: "search-files", label: "Search files", group: "Go to", context: "global", keys: "cmd+p" },
  { id: "search-in-files", label: "Search in files", group: "Go to", context: "global", keys: "cmd+shift+f" },
  // Control on every platform: ⌘Tab never reaches the app.
  { id: "next-conversation", label: "Next conversation", group: "Go to", description: "By recent activity.", context: "global", keys: "ctrl+tab" },
  { id: "previous-conversation", label: "Previous conversation", group: "Go to", context: "global", keys: "ctrl+shift+tab" },
  { id: "history-back", label: "Back", group: "Go to", description: "To the conversation you were in before.", context: "global", keys: "cmd+[" },
  { id: "history-forward", label: "Forward", group: "Go to", context: "global", keys: "cmd+]" },
  { id: "settle-and-next", label: "Settle and go to next", group: "Go to", description: "Settles this conversation and opens the next one waiting for you.", context: "global", keys: "cmd+e" },
  { id: "find-in-thread", label: "Find in conversation", group: "Conversation", description: "In the Browser panel, finds on the page; in Files, searches the tree.", context: "global", keys: "cmd+f" },
  { id: "jump-to-prompt", label: "Jump to a prompt", group: "Conversation", context: "global", keys: "cmd+shift+j" },
  { id: "previous-turn", label: "Previous turn", group: "Conversation", description: "Scrolls to the prompt before the one you are reading.", context: "global", keys: "cmd+alt+arrowup" },
  { id: "next-turn", label: "Next turn", group: "Conversation", context: "global", keys: "cmd+alt+arrowdown" },
  { id: "stop-turn", label: "Stop the running turn", group: "Conversation", description: "From anywhere. Esc also stops it from the composer.", context: "global", keys: "cmd+." },
  { id: "mark-unread", label: "Mark conversation unread", group: "Conversation", context: "global", keys: "cmd+shift+u" },
  // Shift+Escape: a bare key, so it never fires while typing in a field, where the caret already is.
  { id: "focus-composer", label: "Focus the composer", group: "Composer", context: "global", keys: "shift+escape" },
  // M for model, P for permissions. ⇧⌘I belongs to the developer tools on Windows and Linux.
  { id: "open-model", label: "Choose model", group: "Composer", context: "global", keys: "cmd+shift+m" },
  { id: "open-mode", label: "Choose permissions", group: "Composer", context: "global", keys: "cmd+shift+p" },
  { id: "open-effort", label: "Choose effort", group: "Composer", context: "global", keys: "cmd+shift+e" },
  { id: "cycle-favorite-model", label: "Next favorite model", group: "Composer", context: "global", keys: "cmd+alt+m" },
  // L for listen: ⌘⇧D already opens Review, and ⌥ chords arrive as composed characters on macOS.
  { id: "dictation", label: "Start or finish dictation", group: "Composer", context: "global", keys: "cmd+shift+l" },
  { id: "toggle-sidebar", label: "Toggle sidebar", group: "Workspace", context: "global", keys: "cmd+b" },
  { id: "toggle-inspector", label: "Toggle panel", group: "Workspace", context: "global", keys: "cmd+\\" },
  { id: "toggle-terminal", label: "Toggle terminal", group: "Workspace", context: "global", keys: "cmd+j" },
  { id: "open-review", label: "Toggle Review", group: "Workspace", context: "global", keys: "cmd+shift+d" },
  { id: "open-browser", label: "Toggle Browser", group: "Workspace", context: "global", keys: "cmd+shift+b" },
  { id: "reopen-panel", label: "Reopen the closed panel", group: "Workspace", context: "global", keys: "cmd+shift+t" },
  // ⌘O stays Open folder (the menu's); the Option variant opens the conversation's folder in the favourite app.
  { id: "open-in-favorite", label: "Open in favourite app", group: "Workspace", context: "global", keys: "cmd+alt+o" },
];

/** Accelerators the application menu declares on every platform, its standard roles included. */
const MENU_KEYS = [
  "cmd+k", "cmd+n", "cmd+o", "cmd+shift+o", "cmd+,", "cmd+shift+n", "cmd+shift+s", "cmd+shift+r",
  "cmd+w", "cmd+m", "cmd+r", "cmd+z", "cmd+shift+z", "cmd+x", "cmd+c", "cmd+v", "cmd+a",
];

/**
 * Accelerators the application menu declares on this platform, so a binding
 * to one of them can be reported as never firing. The standard roles differ:
 * developer tools are ⌥⌘I on macOS and Control+Shift+I elsewhere, full screen
 * ⌃⌘F or F11, and redo also takes Control+Y on Windows.
 */
export function menuOwnedKeys(mac: boolean): readonly string[] {
  return mac
    ? [...MENU_KEYS, "cmd+q", "cmd+h", "cmd+alt+h", "cmd+alt+i", "ctrl+cmd+f"]
    : [...MENU_KEYS, "cmd+y", "cmd+shift+i", "f11"];
}

const menuFirstChords = (mac: boolean) => new Set(
  menuOwnedKeys(mac).map((keys) => {
    const parsed = parseChordSequence(keys);
    return parsed.ok ? formatChord(parsed.sequence[0]!) : keys;
  }),
);
const MENU_FIRST_CHORDS = { mac: menuFirstChords(true), other: menuFirstChords(false) };

/** Whether the application menu takes this sequence's first key, so the binding never fires. */
export function takenByMenu(sequence: ChordSequence, mac: boolean): boolean {
  if (sequence.length === 0) return false;
  const first = sequence[0]!;
  const chords = mac ? MENU_FIRST_CHORDS.mac : MENU_FIRST_CHORDS.other;
  return chords.has(formatChord(mac || !first.ctrl ? first : { ...first, ctrl: false, meta: true }));
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
export function keybindingWarnings(entries: readonly KeybindingEntry[], known: { commands?: readonly string[]; profiles?: readonly string[]; mac: boolean }): KeymapProblem[] {
  const problems: KeymapProblem[] = [];
  for (const entry of entries) {
    const key = keybindingLocator(entry);
    if (takenByMenu(entry.sequence, known.mac)) {
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
