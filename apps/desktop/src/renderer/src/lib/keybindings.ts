/**
 * The renderer's side of keybindings.json.
 *
 * The defaults are `KEY_COMMANDS` in shared, which main also reads to check
 * the file. keybindings.json's entries arrive parsed in the config snapshot;
 * `resolveKeymap` lays them over the defaults, and `createChordMatcher`
 * matches key presses, chords included, against the result. Menu
 * accelerators still belong to the main process, which sees them before the
 * page does, so those commands are shown as fixed.
 */
import {
  chordKey,
  defaultBindings,
  formatChord,
  KEY_COMMANDS,
  keyCommand,
  KEYMAP_CONTEXTS,
  parseChordSequence,
  parseKeymapAction,
  resolveKeymap,
  type ChordEvent,
  type ChordSequence,
  type CommandSummary,
  type EffectiveBinding,
  type KeybindingEntry,
  type KeyChord,
  type KeymapContext,
} from "@capsule/shared";

export type { KeyChord } from "@capsule/shared";

/**
 * Shortcuts that live outside the registry (in a surface or the composer), in
 * keybindings.json spelling, shown in the shortcuts sheet. A pair gives the
 * macOS keys and everyone else's.
 */
export const FIXED_SHORTCUTS: ReadonlyArray<{ label: string; keys: string | { mac: string; other: string } }> = [
  { label: "Send", keys: "enter" },
  { label: "Stop the running turn, from the composer", keys: "escape" },
  { label: "Cancel dictation and restore the draft", keys: "escape" },
  { label: "Previous prompt", keys: "arrowup" },
  { label: "Switch Plan and Act", keys: "shift+tab" },
  { label: "Edit the last queued follow-up", keys: "alt+arrowup" },
  { label: "Stash the prompt, or open the stash", keys: "cmd+s" },
  { label: "Next region: sidebar, conversation, composer, panel", keys: "f6" },
  { label: "Previous region", keys: "shift+f6" },
  { label: "Open the terminal", keys: "ctrl+`" },
  { label: "Add terminal selection to the message", keys: { mac: "cmd+l", other: "ctrl+shift+l" } },
  { label: "Undo the latest archive, settle or snooze", keys: "cmd+z" },
  { label: "Skills", keys: "cmd+shift+s" },
  { label: "Agents", keys: "cmd+shift+r" },
];

/** The fixed shortcuts as chords for this platform. */
export function fixedShortcuts(mac = isMac()): Array<{ label: string; sequence: ChordSequence }> {
  return FIXED_SHORTCUTS.flatMap(({ label, keys }) => {
    const parsed = parseChordSequence(typeof keys === "string" ? keys : mac ? keys.mac : keys.other);
    return parsed.ok ? [{ label, sequence: parsed.sequence }] : [];
  });
}

export const CONTEXT_LABELS: Record<KeymapContext, string> = {
  global: "Everywhere",
  composer: "Composer",
  panel: "Side panel",
  review: "Review",
  terminal: "Terminal",
  palette: "Command palette",
};

/** A composer listens for this to put a command in the draft, as picking it from the `/` menu does. */
export const INSERT_COMMAND_EVENT = "capsule:insert-command";

/** A registry command the workspace does not run itself, by id, for the surface that owns it. */
export const KEY_COMMAND_EVENT = "capsule:key-command";

/** A command's first effective binding as one label, such as "⇧⌘D" or "Ctrl+Shift+D", or undefined when it has none. */
export function shortcutLabel(id: string, bindings: readonly EffectiveBinding[] = [], mac = isMac()): string | undefined {
  const binding = bindings.find((item) => item.action === id && item.context === "global") ?? bindings.find((item) => item.action === id);
  if (binding) return sequenceLabel(binding.sequence, mac);
  // The menu's commands are not in the keymap, but their keys are fixed and worth showing.
  const command = keyCommand(id);
  const fixed = command?.menuOwned ? parseChordSequence(command.keys) : undefined;
  return fixed?.ok ? sequenceLabel(fixed.sequence, mac) : undefined;
}

/** A tooltip that names the keys a command has now, "Toggle sidebar (⌘B)", or just the label when it has none. */
export function withShortcut(label: string, id: string, bindings: readonly EffectiveBinding[]): string {
  const keys = shortcutLabel(id, bindings);
  return keys ? `${label} (${keys})` : label;
}

export function effectiveKeymap(entries: readonly KeybindingEntry[] | undefined): EffectiveBinding[] {
  return resolveKeymap(defaultBindings(), entries ?? []);
}

const KEY_NAMES: Record<string, string> = { " ": "Space", tab: "Tab", escape: "Esc", enter: "↵", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", backspace: "⌫", delete: "Del" };

/**
 * Display form: macOS symbols in macOS order (⌃⌥⇧⌘), and Ctrl, Alt and Shift
 * elsewhere, where `cmd` is Control.
 */
export function chordSymbols(chord: KeyChord, mac = isMac()): string[] {
  const key = KEY_NAMES[chord.key] ?? (chord.key.length === 1 || /^f\d{1,2}$/.test(chord.key) ? chord.key.toUpperCase() : chord.key);
  if (!mac) {
    return [...(chord.meta || chord.ctrl ? ["Ctrl"] : []), ...(chord.alt ? ["Alt"] : []), ...(chord.shift ? ["Shift"] : []), key === "↵" ? "Enter" : key];
  }
  return [...(chord.ctrl ? ["⌃"] : []), ...(chord.alt ? ["⌥"] : []), ...(chord.shift ? ["⇧"] : []), ...(chord.meta ? ["⌘"] : []), key];
}

export function sequenceSymbols(sequence: ChordSequence, mac = isMac()): string[][] {
  return sequence.map((chord) => chordSymbols(chord, mac));
}

/** A sequence as one string: "⇧⌘D" on macOS, "Ctrl+Shift+D" elsewhere, chords separated by a space. */
export function sequenceLabel(sequence: ChordSequence, mac = isMac()): string {
  return sequenceSymbols(sequence, mac).map((chord) => chord.join(mac ? "" : "+")).join(" ");
}

/** What a binding's action does, in words. */
export function actionLabel(action: string, commands?: readonly CommandSummary[]): string {
  const { namespace, name } = parseKeymapAction(action);
  if (namespace === "command") {
    const command = commands?.find((item) => item.name === name);
    return command?.description ? `/${name} · ${command.description}` : `/${name}`;
  }
  if (namespace === "profile") return `Profile ${name}`;
  if (namespace === "action") return `Run ${name}`;
  return keyCommand(name)?.label ?? name;
}

const MODIFIER_KEYS = new Set(["meta", "control", "shift", "alt", "os", "capslock"]);

/**
 * A key press as a chord, for recording a binding or searching by
 * keystroke. ⌘ is the primary modifier on macOS and Control elsewhere; on
 * macOS Control is kept as itself, so emacs-style ⌃A stays ⌃A.
 */
export function chordFromEvent(event: ChordEvent, mac = isMac()): KeyChord | undefined {
  if (MODIFIER_KEYS.has(event.key.toLowerCase())) return undefined;
  const key = chordKey(event, mac);
  const chord: KeyChord = { key };
  if (mac ? event.metaKey : event.ctrlKey || event.metaKey) chord.meta = true;
  if (mac && event.ctrlKey) chord.ctrl = true;
  if (event.altKey) chord.alt = true;
  if (event.shiftKey) chord.shift = true;
  return chord;
}

export function sequenceStartsWith(sequence: ChordSequence, prefix: ChordSequence): boolean {
  return prefix.length <= sequence.length && prefix.every((chord, index) => formatChord(chord) === formatChord(sequence[index]!));
}

/** The surfaces around an element, most specific first, from `data-keymap-context` attributes. */
export function contextStack(target: EventTarget | null): KeymapContext[] {
  const stack: KeymapContext[] = [];
  let node = target instanceof Element ? target.closest("[data-keymap-context]") : null;
  while (node) {
    const context = node.getAttribute("data-keymap-context");
    if ((KEYMAP_CONTEXTS as readonly string[]).includes(context ?? "") && !stack.includes(context as KeymapContext)) stack.push(context as KeymapContext);
    node = node.parentElement?.closest("[data-keymap-context]") ?? null;
  }
  return stack;
}

/** Every registry command, with its effective keys, for Settings and the shortcuts sheet. */
export function registryRows(bindings: readonly EffectiveBinding[]) {
  return KEY_COMMANDS.map((command) => ({
    command,
    bindings: command.menuOwned ? [] : bindings.filter((binding) => binding.action === command.id),
  }));
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
