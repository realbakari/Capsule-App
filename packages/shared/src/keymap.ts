export const KEYMAP_CONTEXTS = ["global", "composer", "panel", "review", "terminal", "palette"] as const;

export type KeymapContext = (typeof KEYMAP_CONTEXTS)[number];

/**
 * The renderer's chord shape. `meta` is the primary modifier, ⌘ on macOS and
 * Control elsewhere, and matches either. `ctrl` is the physical Control key
 * and is set only when a binding writes `ctrl` or `control`.
 */
export interface KeyChord {
  /** Lower-case `KeyboardEvent.key`, or the literal for punctuation. */
  key: string;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

/** One or two chords, such as `cmd+k cmd+r`. */
export type ChordSequence = KeyChord[];

export const MAX_SEQUENCE_LENGTH = 2;

const MODIFIERS: Record<string, "meta" | "ctrl" | "alt" | "shift"> = {
  cmd: "meta",
  meta: "meta",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
};

const KEY_ALIASES: Record<string, string> = {
  space: " ",
  esc: "escape",
  return: "enter",
  del: "delete",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  plus: "+",
};

const KEY_NAMES: Record<string, string> = { " ": "space", "+": "plus" };

export type ParsedSequence = { ok: true; sequence: ChordSequence } | { ok: false; message: string };

export function parseChordSequence(text: string): ParsedSequence {
  const chords = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (chords.length === 0) return { ok: false, message: "A binding needs at least one key." };
  if (chords.length > MAX_SEQUENCE_LENGTH) return { ok: false, message: `"${text}" has more than ${MAX_SEQUENCE_LENGTH} chords.` };
  const sequence: ChordSequence = [];
  for (const chordText of chords) {
    const parts = chordText.endsWith("++") ? [...chordText.slice(0, -2).split("+"), "+"] : chordText.split("+");
    const rawKey = parts.pop();
    if (!rawKey || parts.some((p) => !p)) return { ok: false, message: `"${chordText}" is not a chord. Write modifiers and a key joined by +, such as cmd+shift+k.` };
    if (MODIFIERS[rawKey]) return { ok: false, message: `"${chordText}" has no key after its modifiers.` };
    const chord: KeyChord = { key: KEY_ALIASES[rawKey] ?? rawKey };
    for (const part of parts) {
      const modifier = MODIFIERS[part];
      if (!modifier) return { ok: false, message: `"${part}" in "${chordText}" is not a modifier. Use cmd, ctrl, alt or shift.` };
      chord[modifier] = true;
    }
    sequence.push(chord);
  }
  return { ok: true, sequence };
}

export function formatChord(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("ctrl");
  if (chord.alt) parts.push("alt");
  if (chord.shift) parts.push("shift");
  if (chord.meta) parts.push("cmd");
  parts.push(KEY_NAMES[chord.key] ?? chord.key);
  return parts.join("+");
}

/** Canonical text: one spelling per sequence, so two bindings can be compared as strings. */
export function formatChordSequence(sequence: ChordSequence): string {
  return sequence.map(formatChord).join(" ");
}

/** The fields of a `KeyboardEvent` the matcher reads. */
export interface ChordEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Modifiers match exactly in both directions, as in the renderer's
 * `matchesChord`, so ⌘B does not also fire on ⌘⇧B. A chord without `ctrl`
 * behaves exactly as it does there.
 */
export function chordMatchesEvent(chord: KeyChord, event: ChordEvent): boolean {
  if (event.key.toLowerCase() !== chord.key) return false;
  if (Boolean(chord.shift) !== event.shiftKey || Boolean(chord.alt) !== event.altKey) return false;
  if (chord.ctrl) return event.ctrlKey && Boolean(chord.meta) === event.metaKey;
  return Boolean(chord.meta) === (event.metaKey || event.ctrlKey);
}

/** `command:review`, `profile:fast`, `action:toggle-sidebar`, or a plain id. */
export type KeymapAction =
  | { namespace: "command" | "profile" | "action"; name: string }
  | { namespace: undefined; name: string };

export function parseKeymapAction(action: string): KeymapAction {
  const match = /^(command|profile|action):(.*)$/.exec(action);
  return match ? { namespace: match[1] as "command" | "profile" | "action", name: match[2]! } : { namespace: undefined, name: action };
}

export interface KeybindingEntry {
  context: KeymapContext;
  sequence: ChordSequence;
  /** `null` unbinds whatever holds this sequence in this context. */
  action: string | null;
}

export interface KeymapProblem {
  /** Locator in the file, such as `[0].bindings["cmd+k"]`. */
  key: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseKeybindingsFile(json: unknown): { entries: KeybindingEntry[]; problems: KeymapProblem[] } {
  const entries: KeybindingEntry[] = [];
  const problems: KeymapProblem[] = [];
  if (!Array.isArray(json)) {
    return { entries, problems: [{ key: "", message: "The file must be a list of { context, bindings } blocks." }] };
  }
  json.forEach((block, index) => {
    const at = `[${index}]`;
    if (!isRecord(block)) {
      problems.push({ key: at, message: "Each block must be an object with context and bindings." });
      return;
    }
    const context = block.context ?? "global";
    if (typeof context !== "string" || !(KEYMAP_CONTEXTS as readonly string[]).includes(context)) {
      problems.push({ key: `${at}.context`, message: `context must be one of ${KEYMAP_CONTEXTS.join(", ")}.` });
      return;
    }
    if (!isRecord(block.bindings)) {
      problems.push({ key: `${at}.bindings`, message: "bindings must map key sequences to actions." });
      return;
    }
    for (const [text, action] of Object.entries(block.bindings)) {
      const where = `${at}.bindings[${JSON.stringify(text)}]`;
      const parsed = parseChordSequence(text);
      if (!parsed.ok) {
        problems.push({ key: where, message: parsed.message });
        continue;
      }
      if (action !== null && (typeof action !== "string" || !action.trim())) {
        problems.push({ key: where, message: "The action must be an action id, or null to unbind." });
        continue;
      }
      if (typeof action === "string") {
        const { namespace, name } = parseKeymapAction(action.trim());
        if (namespace && !name) {
          problems.push({ key: where, message: `"${action}" names no ${namespace}.` });
          continue;
        }
      }
      entries.push({ context: context as KeymapContext, sequence: parsed.sequence, action: action === null ? null : action.trim() });
    }
  });
  return { entries, problems };
}

export interface DefaultBinding {
  id: string;
  context: KeymapContext;
  sequence: ChordSequence;
}

export interface EffectiveBinding {
  action: string;
  context: KeymapContext;
  sequence: ChordSequence;
  source: "default" | "user";
}

/**
 * Entries apply in file order. Binding an action replaces its default keys,
 * and takes the sequence from whatever held it in that context. `null`
 * removes whatever holds the sequence in that context.
 */
export function resolveKeymap(defaults: readonly DefaultBinding[], entries: readonly KeybindingEntry[]): EffectiveBinding[] {
  let bindings: EffectiveBinding[] = defaults.map((d) => ({ action: d.id, context: d.context, sequence: d.sequence, source: "default" }));
  for (const entry of entries) {
    const key = formatChordSequence(entry.sequence);
    bindings = bindings.filter(
      (b) =>
        !(b.context === entry.context && formatChordSequence(b.sequence) === key) &&
        !(entry.action !== null && b.source === "default" && b.action === entry.action),
    );
    if (entry.action !== null) bindings.push({ action: entry.action, context: entry.context, sequence: entry.sequence, source: "user" });
  }
  return bindings;
}

export interface KeymapConflict {
  context: KeymapContext;
  /** `duplicate`: one sequence, two actions. `prefix`: a single chord that fires before a sequence starting with it can finish. */
  kind: "duplicate" | "prefix";
  sequence: string;
  actions: string[];
}

export function keymapConflicts(bindings: readonly EffectiveBinding[]): KeymapConflict[] {
  const conflicts: KeymapConflict[] = [];
  for (const context of KEYMAP_CONTEXTS) {
    const inContext = bindings.filter((b) => b.context === context);
    const bySequence = new Map<string, string[]>();
    for (const b of inContext) {
      const key = formatChordSequence(b.sequence);
      bySequence.set(key, [...(bySequence.get(key) ?? []), b.action]);
    }
    for (const [sequence, actions] of bySequence) {
      if (actions.length > 1) conflicts.push({ context, kind: "duplicate", sequence, actions });
    }
    for (const single of inContext.filter((b) => b.sequence.length === 1)) {
      const first = formatChord(single.sequence[0]!);
      const shadowed = inContext.filter((b) => b.sequence.length > 1 && formatChord(b.sequence[0]!) === first);
      if (shadowed.length > 0) {
        conflicts.push({ context, kind: "prefix", sequence: first, actions: [single.action, ...shadowed.map((b) => b.action)] });
      }
    }
  }
  return conflicts;
}

export type ChordMatch =
  | { kind: "match"; action: string; context: KeymapContext }
  | { kind: "pending"; prefix: KeyChord }
  | { kind: "none" };

export const SEQUENCE_TIMEOUT_MS = 1500;

const MODIFIER_KEYS = new Set(["meta", "control", "shift", "alt", "os", "capslock"]);

export interface ChordMatcher {
  /** Feed one keydown. `time` is milliseconds, such as `event.timeStamp`. */
  feed(event: ChordEvent & { time: number }): ChordMatch;
  /** The focused surfaces, most specific first. Global is always searched last. */
  setContexts(stack: readonly KeymapContext[]): void;
  reset(): void;
}

/**
 * A two-state machine: idle, or holding the first chord of a sequence for up
 * to 1.5 s. The most specific active context answers first, and within one
 * context a single chord wins over a sequence it starts.
 */
export function createChordMatcher(bindings: readonly EffectiveBinding[], timeoutMs = SEQUENCE_TIMEOUT_MS): ChordMatcher {
  let contexts: KeymapContext[] = ["global"];
  let pending: { chord: KeyChord; time: number } | undefined;

  const inOrder = () => contexts.map((context) => bindings.filter((b) => b.context === context));

  const second = (event: ChordEvent, first: KeyChord): ChordMatch | undefined => {
    for (const group of inOrder()) {
      const hit = group.find(
        (b) => b.sequence.length === 2 && formatChord(b.sequence[0]!) === formatChord(first) && chordMatchesEvent(b.sequence[1]!, event),
      );
      if (hit) return { kind: "match", action: hit.action, context: hit.context };
    }
    return undefined;
  };

  return {
    setContexts(stack) {
      contexts = [...stack.filter((c) => c !== "global"), "global"];
      pending = undefined;
    },
    reset() {
      pending = undefined;
    },
    feed(event) {
      if (MODIFIER_KEYS.has(event.key.toLowerCase())) return pending ? { kind: "pending", prefix: pending.chord } : { kind: "none" };
      if (pending && event.time - pending.time > timeoutMs) pending = undefined;
      if (pending) {
        const first = pending.chord;
        pending = undefined;
        const hit = second(event, first);
        if (hit) return hit;
      }
      for (const group of inOrder()) {
        const single = group.find((b) => b.sequence.length === 1 && chordMatchesEvent(b.sequence[0]!, event));
        if (single) return { kind: "match", action: single.action, context: single.context };
        const prefix = group.find((b) => b.sequence.length === 2 && chordMatchesEvent(b.sequence[0]!, event));
        if (prefix) {
          pending = { chord: prefix.sequence[0]!, time: event.time };
          return { kind: "pending", prefix: prefix.sequence[0]! };
        }
      }
      return { kind: "none" };
    },
  };
}
