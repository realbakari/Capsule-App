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

/** Shortcuts that live outside the registry (in a surface or the composer), shown in the shortcuts sheet. */
export const FIXED_SHORTCUTS: Array<{ label: string; keys: string[] }> = [
  { label: "Send", keys: ["↵"] },
  { label: "Stop the running turn", keys: ["Esc"] },
  { label: "Cancel dictation and restore the draft", keys: ["Esc"] },
  { label: "Previous prompt", keys: ["↑"] },
  { label: "Switch Plan and Act", keys: ["⇧", "Tab"] },
  { label: "Edit the last queued follow-up", keys: ["⌥", "↑"] },
  { label: "Next region: sidebar, conversation, composer, panel", keys: ["F6"] },
  { label: "Previous region", keys: ["⇧", "F6"] },
  { label: "Side chat", keys: ["⌥", "⌘", "S"] },
  { label: "Open the terminal", keys: ["⌃", "`"] },
  { label: "Add terminal selection to the message", keys: ["⌘", "L"] },
  { label: "Skills", keys: ["⇧", "⌘", "S"] },
  { label: "Agents", keys: ["⇧", "⌘", "R"] },
];

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

/** A command's first effective binding as one label, such as "⇧⌘D", or undefined when it has none. */
export function shortcutLabel(id: string, bindings: readonly EffectiveBinding[]): string | undefined {
  const binding = bindings.find((item) => item.action === id && item.context === "global") ?? bindings.find((item) => item.action === id);
  return binding ? sequenceSymbols(binding.sequence).map((chord) => chord.join("")).join(" ") : undefined;
}

export function effectiveKeymap(entries: readonly KeybindingEntry[] | undefined): EffectiveBinding[] {
  return resolveKeymap(defaultBindings(), entries ?? []);
}

/** Display form. `cmd` matches Control too; ⌘Tab belongs to the system, so a Tab chord is shown as ⌃. */
export function chordSymbols(chord: KeyChord): string[] {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("⌃");
  if (chord.alt) parts.push("⌥");
  if (chord.shift) parts.push("⇧");
  if (chord.meta) parts.push(chord.key === "tab" && !chord.ctrl ? "⌃" : "⌘");
  const names: Record<string, string> = { " ": "Space", tab: "Tab", escape: "Esc", enter: "↵", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", backspace: "⌫" };
  parts.push(names[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key));
  return parts;
}

export function sequenceSymbols(sequence: ChordSequence): string[][] {
  return sequence.map(chordSymbols);
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
  const key = chordKey(event);
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

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
